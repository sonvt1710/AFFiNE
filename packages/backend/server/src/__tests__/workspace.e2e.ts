import { PrismaClient } from '@prisma/client';
import type { TestFn } from 'ava';
import ava from 'ava';
import request from 'supertest';

import { AppModule } from '../app.module';
import {
  acceptInviteById,
  createTestingApp,
  createWorkspace,
  getWorkspacePublicPages,
  inviteUser,
  publishDoc,
  revokePublicDoc,
  signUp,
  TestingApp,
  updateWorkspace,
} from './utils';

const test = ava as TestFn<{
  app: TestingApp;
  client: PrismaClient;
}>;

test.before(async t => {
  const { app } = await createTestingApp({
    imports: [AppModule],
  });

  t.context.client = app.get(PrismaClient);
  t.context.app = app;
});

test.beforeEach(async t => {
  await t.context.app.initTestingDB();
});

test.after.always(async t => {
  await t.context.app.close();
});

test('should register a user', async t => {
  const user = await signUp(t.context.app, 'u1', 'u1@affine.pro', '123456');
  t.is(typeof user.id, 'string', 'user.id is not a string');
  t.is(user.name, 'u1', 'user.name is not valid');
  t.is(user.email, 'u1@affine.pro', 'user.email is not valid');
});

test('should create a workspace', async t => {
  const { app } = t.context;
  const user = await signUp(app, 'u1', 'u1@affine.pro', '1');

  const workspace = await createWorkspace(app, user.token.token);
  t.is(typeof workspace.id, 'string', 'workspace.id is not a string');
});

test('should be able to publish workspace', async t => {
  const { app } = t.context;
  const user = await signUp(app, 'u1', 'u1@affine.pro', '1');
  const workspace = await createWorkspace(app, user.token.token);

  const isPublic = await updateWorkspace(
    app,
    user.token.token,
    workspace.id,
    true
  );
  t.true(isPublic, 'failed to publish workspace');

  const isPrivate = await updateWorkspace(
    app,
    user.token.token,
    workspace.id,
    false
  );
  t.false(isPrivate, 'failed to unpublish workspace');
});

test('should share a page', async t => {
  const { app } = t.context;
  const u1 = await signUp(app, 'u1', 'u1@affine.pro', '1');
  const u2 = await signUp(app, 'u2', 'u2@affine.pro', '1');

  const workspace = await createWorkspace(app, u1.token.token);

  const share = await publishDoc(app, u1.token.token, workspace.id, 'doc1');
  t.is(share.id, 'doc1', 'failed to share doc');
  const pages = await getWorkspacePublicPages(
    app,
    u1.token.token,
    workspace.id
  );
  t.is(pages.length, 1, 'failed to get shared pages');
  t.deepEqual(
    pages[0],
    { id: 'doc1', mode: 'Page' },
    'failed to get shared doc: doc1'
  );

  const resp1 = await request(app.getHttpServer())
    .get(`/api/workspaces/${workspace.id}/docs/${workspace.id}`)
    .auth(u1.token.token, { type: 'bearer' });
  t.is(resp1.statusCode, 200, 'failed to get root doc with u1 token');
  const resp2 = await request(app.getHttpServer()).get(
    `/api/workspaces/${workspace.id}/docs/${workspace.id}`
  );
  t.is(resp2.statusCode, 200, 'failed to get root doc with public pages');

  const resp3 = await request(app.getHttpServer())
    .get(`/api/workspaces/${workspace.id}/docs/doc1`)
    .auth(u1.token.token, { type: 'bearer' });
  // 404 because we don't put the page doc to server
  t.is(resp3.statusCode, 404, 'failed to get shared doc with u1 token');
  const resp4 = await request(app.getHttpServer()).get(
    `/api/workspaces/${workspace.id}/docs/doc1`
  );
  // 404 because we don't put the page doc to server
  t.is(resp4.statusCode, 404, 'should not get shared doc without token');

  const msg1 = await publishDoc(app, u2.token.token, 'not_exists_ws', 'doc2');
  t.is(
    msg1,
    'You do not have permission to access doc doc2 under Space not_exists_ws.',
    'unauthorized user can share doc'
  );
  const msg2 = await revokePublicDoc(
    app,
    u2.token.token,
    'not_exists_ws',
    'doc2'
  );
  t.is(
    msg2,
    'You do not have permission to access doc doc2 under Space not_exists_ws.',
    'unauthorized user can share doc'
  );
  const revoke = await revokePublicDoc(
    app,
    u1.token.token,
    workspace.id,
    'doc1'
  );
  t.false(revoke.public, 'failed to revoke doc');
  const pages2 = await getWorkspacePublicPages(
    app,
    u1.token.token,
    workspace.id
  );
  t.is(pages2.length, 0, 'failed to get shared pages');
  const msg4 = await revokePublicDoc(app, u1.token.token, workspace.id, 'doc3');
  t.is(msg4, 'Doc is not public');

  const pages3 = await getWorkspacePublicPages(
    app,
    u1.token.token,
    workspace.id
  );
  t.is(pages3.length, 0, 'failed to get shared pages');
});

test('should be able to get workspace doc', async t => {
  const { app } = t.context;
  const u1 = await signUp(app, 'u1', 'u1@affine.pro', '1');
  const u2 = await signUp(app, 'u2', 'u2@affine.pro', '2');
  const workspace = await createWorkspace(app, u1.token.token);

  const res1 = await request(app.getHttpServer())
    .get(`/api/workspaces/${workspace.id}/docs/${workspace.id}`)
    .auth(u1.token.token, { type: 'bearer' })
    .expect(200)
    .type('application/octet-stream');

  t.deepEqual(
    res1.body,
    Buffer.from([0, 0]),
    'failed to get doc with u1 token'
  );

  await request(app.getHttpServer())
    .get(`/api/workspaces/${workspace.id}/docs/${workspace.id}`)
    .expect(403);
  await request(app.getHttpServer())
    .get(`/api/workspaces/${workspace.id}/docs/${workspace.id}`)
    .auth(u2.token.token, { type: 'bearer' })
    .expect(403);

  await request(app.getHttpServer())
    .get(`/api/workspaces/${workspace.id}/docs/${workspace.id}`)
    .auth(u2.token.token, { type: 'bearer' })
    .expect(403);

  await acceptInviteById(
    app,
    workspace.id,
    await inviteUser(app, u1.token.token, workspace.id, u2.email)
  );

  const res2 = await request(app.getHttpServer())
    .get(`/api/workspaces/${workspace.id}/docs/${workspace.id}`)
    .auth(u2.token.token, { type: 'bearer' })
    .expect(200)
    .type('application/octet-stream');

  t.deepEqual(
    res2.body,
    Buffer.from([0, 0]),
    'failed to get doc with u2 token'
  );
});

test('should be able to get public workspace doc', async t => {
  const { app } = t.context;
  const user = await signUp(app, 'u1', 'u1@affine.pro', '1');
  const workspace = await createWorkspace(app, user.token.token);

  const isPublic = await updateWorkspace(
    app,
    user.token.token,
    workspace.id,
    true
  );

  t.true(isPublic, 'failed to publish workspace');

  const res = await request(app.getHttpServer())
    .get(`/api/workspaces/${workspace.id}/docs/${workspace.id}`)
    .expect(200)
    .type('application/octet-stream');

  t.deepEqual(res.body, Buffer.from([0, 0]), 'failed to get public doc');
});
