import { randomUUID } from 'node:crypto';

import { User, Workspace } from '@prisma/client';
import ava, { TestFn } from 'ava';
import { applyUpdate, Doc as YDoc } from 'yjs';

import { createTestingApp, type TestingApp } from '../../../__tests__/utils';
import { AppModule } from '../../../app.module';
import { ConfigModule } from '../../../base/config';
import { Models } from '../../../models';
import { DocReader } from '..';
import { DatabaseDocReader } from '../reader';

const test = ava as TestFn<{
  models: Models;
  app: TestingApp;
  docReader: DocReader;
}>;

test.before(async t => {
  const app = await createTestingApp({
    imports: [ConfigModule.forRoot(), AppModule],
  });

  t.context.models = app.get(Models);
  t.context.docReader = app.get(DocReader);
  t.context.app = app;
});

let user: User;
let workspace: Workspace;

test.beforeEach(async t => {
  await t.context.app.initTestingDB();
  user = await t.context.models.user.create({
    email: 'test@affine.pro',
  });
  workspace = await t.context.models.workspace.create(user.id);
});

test.after.always(async t => {
  await t.context.app.close();
});

test('should return null when doc not found', async t => {
  const { docReader } = t.context;
  const docId = randomUUID();
  const doc = await docReader.getDoc(workspace.id, docId);
  t.is(doc, null);
});

test('should return doc when found', async t => {
  const { docReader } = t.context;
  t.true(docReader instanceof DatabaseDocReader);

  const docId = randomUUID();
  const timestamp = Date.now();
  await t.context.models.doc.createUpdates([
    {
      spaceId: workspace.id,
      docId,
      blob: Buffer.from('blob1 data'),
      timestamp,
      editorId: user.id,
    },
  ]);

  const doc = await docReader.getDoc(workspace.id, docId);
  t.truthy(doc);
  t.is(doc!.bin.toString(), 'blob1 data');
  t.is(doc!.timestamp, timestamp);
  t.is(doc!.editor, user.id);
});

test('should return doc diff', async t => {
  const { docReader } = t.context;
  const docId = randomUUID();
  const timestamp = Date.now();
  let updates: Buffer[] = [];
  const doc1 = new YDoc();
  doc1.on('update', data => {
    updates.push(Buffer.from(data));
  });

  const text = doc1.getText('content');
  text.insert(0, 'hello');
  text.insert(5, 'world');
  text.insert(5, ' ');
  text.insert(11, '!');

  await t.context.models.doc.createUpdates(
    updates.map((update, index) => ({
      spaceId: workspace.id,
      docId,
      blob: update,
      timestamp: timestamp + index,
      editorId: user.id,
    }))
  );
  // clear updates
  updates.splice(0, updates.length);

  const doc2 = new YDoc();
  const diff = await docReader.getDocDiff(workspace.id, docId);
  t.truthy(diff);
  t.truthy(diff!.missing);
  t.truthy(diff!.state);
  applyUpdate(doc2, diff!.missing);
  t.is(doc2.getText('content').toString(), 'hello world!');

  // nothing changed
  const diff2 = await docReader.getDocDiff(workspace.id, docId, diff!.state);
  t.truthy(diff2);
  t.truthy(diff2!.missing);
  t.deepEqual(diff2!.missing, new Uint8Array([0, 0]));
  t.truthy(diff2!.state);
  applyUpdate(doc2, diff2!.missing);
  t.is(doc2.getText('content').toString(), 'hello world!');

  // add new content on doc1
  text.insert(12, '@');
  await t.context.models.doc.createUpdates(
    updates.map((update, index) => ({
      spaceId: workspace.id,
      docId,
      blob: update,
      timestamp: Date.now() + index + 1000,
      editorId: user.id,
    }))
  );

  const diff3 = await docReader.getDocDiff(workspace.id, docId, diff2!.state);
  t.truthy(diff3);
  t.truthy(diff3!.missing);
  t.truthy(diff3!.state);
  applyUpdate(doc2, diff3!.missing);
  t.is(doc2.getText('content').toString(), 'hello world!@');
});
