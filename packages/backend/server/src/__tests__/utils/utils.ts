import { INestApplication, LogLevel, ModuleMetadata } from '@nestjs/common';
import { APP_GUARD, ModuleRef } from '@nestjs/core';
import { Query, Resolver } from '@nestjs/graphql';
import {
  Test,
  TestingModule as BaseTestingModule,
  TestingModuleBuilder,
} from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import cookieParser from 'cookie-parser';
import graphqlUploadExpress from 'graphql-upload/graphqlUploadExpress.mjs';
import type { Response } from 'supertest';
import supertest from 'supertest';

import { AppModule, FunctionalityModules } from '../../app.module';
import { AFFiNELogger, GlobalExceptionFilter, Runtime } from '../../base';
import { GqlModule } from '../../base/graphql';
import { AuthGuard, AuthModule } from '../../core/auth';
import { RefreshFeatures0001 } from '../../data/migrations/0001-refresh-features';
import { ModelsModule } from '../../models';

const TEST_LOG_LEVEL: LogLevel =
  (process.env.TEST_LOG_LEVEL as LogLevel) ?? 'fatal';

async function flushDB(client: PrismaClient) {
  const result: { tablename: string }[] =
    await client.$queryRaw`SELECT tablename
                           FROM pg_catalog.pg_tables
                           WHERE schemaname != 'pg_catalog'
                             AND schemaname != 'information_schema'`;

  // remove all table data
  await client.$executeRawUnsafe(
    `TRUNCATE TABLE ${result
      .map(({ tablename }) => tablename)
      .filter(name => !name.includes('migrations'))
      .join(', ')}`
  );
}

interface TestingModuleMetadata extends ModuleMetadata {
  tapModule?(m: TestingModuleBuilder): void;
  tapApp?(app: INestApplication): void;
}

const initTestingDB = async (ref: ModuleRef) => {
  const db = ref.get(PrismaClient, { strict: false });
  await flushDB(db);
  await RefreshFeatures0001.up(db, ref);
};

export type TestingModule = BaseTestingModule & {
  initTestingDB(): Promise<void>;
  [Symbol.asyncDispose](): Promise<void>;
};

export type TestingApp = INestApplication & {
  initTestingDB(): Promise<void>;
  [Symbol.asyncDispose](): Promise<void>;
  // get the url of the http server, e.g. http://localhost:random-port
  getHttpServerUrl(): string;
};

function dedupeModules(modules: NonNullable<ModuleMetadata['imports']>) {
  const map = new Map();

  modules.forEach(m => {
    if ('module' in m) {
      map.set(m.module, m);
    } else {
      map.set(m, m);
    }
  });

  return Array.from(map.values());
}

@Resolver(() => String)
class MockResolver {
  @Query(() => String)
  hello() {
    return 'hello world';
  }
}

export async function createTestingModule(
  moduleDef: TestingModuleMetadata = {},
  autoInitialize = true
): Promise<TestingModule> {
  // setting up
  let imports = moduleDef.imports ?? [];
  imports =
    imports[0] === AppModule
      ? [AppModule]
      : dedupeModules([
          ...FunctionalityModules,
          ModelsModule,
          AuthModule,
          GqlModule,
          ...imports,
        ]);

  const builder = Test.createTestingModule({
    imports,
    providers: [
      {
        provide: APP_GUARD,
        useClass: AuthGuard,
      },
      MockResolver,
      ...(moduleDef.providers ?? []),
    ],
    controllers: moduleDef.controllers,
  });

  if (moduleDef.tapModule) {
    moduleDef.tapModule(builder);
  }

  const m = await builder.compile();

  const testingModule = m as TestingModule;
  testingModule.initTestingDB = async () => {
    await initTestingDB(m.get(ModuleRef));
    // we got a lot smoking tests try to break nestjs
    // can't tolerate the noisy logs
    // @ts-expect-error private
    m.applyLogger({
      logger: [TEST_LOG_LEVEL],
    });
    const runtime = m.get(Runtime);
    // by pass password min length validation
    await runtime.set('auth/password.min', 1);
  };
  testingModule[Symbol.asyncDispose] = async () => {
    await m.close();
  };

  if (autoInitialize) {
    await testingModule.initTestingDB();
    await testingModule.init();
  }

  return testingModule;
}

export async function createTestingApp(
  moduleDef: TestingModuleMetadata = {}
): Promise<{ module: TestingModule; app: TestingApp }> {
  const m = await createTestingModule(moduleDef, false);

  const app = m.createNestApplication({
    cors: true,
    bodyParser: true,
    rawBody: true,
  }) as TestingApp;
  const logger = new AFFiNELogger();

  logger.setLogLevels([TEST_LOG_LEVEL]);
  app.useLogger(logger);

  app.useGlobalFilters(new GlobalExceptionFilter(app.getHttpAdapter()));
  app.use(
    graphqlUploadExpress({
      maxFileSize: 10 * 1024 * 1024,
      maxFiles: 5,
    })
  );

  app.use(cookieParser());

  if (moduleDef.tapApp) {
    moduleDef.tapApp(app);
  }

  await m.initTestingDB();
  await app.init();

  app.initTestingDB = m.initTestingDB.bind(m);
  app[Symbol.asyncDispose] = async () => {
    await m[Symbol.asyncDispose]();
    await app.close();
  };

  app.getHttpServerUrl = () => {
    const server = app.getHttpServer();
    if (!server.address()) {
      server.listen();
    }
    return `http://localhost:${server.address().port}`;
  };

  return {
    module: m,
    app: app,
  };
}

export function handleGraphQLError(resp: Response) {
  const { errors } = resp.body;
  if (errors) {
    const cause = errors[0];
    const stacktrace = cause.extensions?.stacktrace;
    throw new Error(
      stacktrace
        ? Array.isArray(stacktrace)
          ? stacktrace.join('\n')
          : String(stacktrace)
        : cause.message,
      cause
    );
  }
}

export function gql(app: INestApplication, query?: string) {
  const req = supertest(app.getHttpServer())
    .post('/graphql')
    .set({ 'x-request-id': 'test', 'x-operation-name': 'test' });

  if (query) {
    return req.send({ query });
  }

  return req;
}

export async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
