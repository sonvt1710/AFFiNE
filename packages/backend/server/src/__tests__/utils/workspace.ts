import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { WorkspaceRole } from '../../core/permission/types';
import type { WorkspaceType } from '../../core/workspaces';
import { gql } from './common';

export async function createWorkspace(
  app: INestApplication,
  token: string
): Promise<WorkspaceType> {
  const res = await request(app.getHttpServer())
    .post(gql)
    .auth(token, { type: 'bearer' })
    .set({ 'x-request-id': 'test', 'x-operation-name': 'test' })
    .field(
      'operations',
      JSON.stringify({
        name: 'createWorkspace',
        query: `mutation createWorkspace($init: Upload!) {
              createWorkspace(init: $init) {
                id
              }
            }`,
        variables: { init: null },
      })
    )
    .field('map', JSON.stringify({ '0': ['variables.init'] }))
    .attach('0', Buffer.from([0, 0]), 'init.data')
    .expect(200);
  return res.body.data.createWorkspace;
}

export async function getWorkspacePublicPages(
  app: INestApplication,
  token: string,
  workspaceId: string
) {
  const res = await request(app.getHttpServer())
    .post(gql)
    .auth(token, { type: 'bearer' })
    .set({ 'x-request-id': 'test', 'x-operation-name': 'test' })
    .send({
      query: `
            query {
              workspace(id: "${workspaceId}") {
                publicPages {
                  id
                  mode
                }
              }
            }
          `,
    })
    .expect(200);
  return res.body.data.workspace.publicPages;
}

export async function getWorkspace(
  app: INestApplication,
  token: string,
  workspaceId: string,
  skip = 0,
  take = 8
): Promise<WorkspaceType> {
  const res = await request(app.getHttpServer())
    .post(gql)
    .auth(token, { type: 'bearer' })
    .set({ 'x-request-id': 'test', 'x-operation-name': 'test' })
    .send({
      query: `
            query {
              workspace(id: "${workspaceId}") {
                id, members(skip: ${skip}, take: ${take}) { id, name, email, permission, inviteId, status }
              }
            }
          `,
    })
    .expect(200);
  return res.body.data.workspace;
}

export async function updateWorkspace(
  app: INestApplication,
  token: string,
  workspaceId: string,
  isPublic: boolean
): Promise<boolean> {
  const res = await request(app.getHttpServer())
    .post(gql)
    .auth(token, { type: 'bearer' })
    .set({ 'x-request-id': 'test', 'x-operation-name': 'test' })
    .send({
      query: `
            mutation {
              updateWorkspace(input: { id: "${workspaceId}", public: ${isPublic} }) {
                public
              }
            }
          `,
    })
    .expect(200);
  return res.body.data.updateWorkspace.public;
}

export async function publishDoc(
  app: INestApplication,
  token: string,
  workspaceId: string,
  docId: string
) {
  const res = await request(app.getHttpServer())
    .post(gql)
    .auth(token, { type: 'bearer' })
    .set({ 'x-request-id': 'test', 'x-operation-name': 'test' })
    .send({
      query: `
            mutation {
              publishDoc(workspaceId: "${workspaceId}", docId: "${docId}") {
                id
                mode
              }
            }
          `,
    })
    .expect(200);
  return res.body.errors?.[0]?.message || res.body.data?.publishDoc;
}

export async function revokePublicDoc(
  app: INestApplication,
  token: string,
  workspaceId: string,
  docId: string
) {
  const res = await request(app.getHttpServer())
    .post(gql)
    .auth(token, { type: 'bearer' })
    .set({ 'x-request-id': 'test', 'x-operation-name': 'test' })
    .send({
      query: `
            mutation {
              revokePublicDoc(workspaceId: "${workspaceId}", docId: "${docId}") {
                id
                mode
                public
              }
            }
          `,
    })
    .expect(200);
  return res.body.errors?.[0]?.message || res.body.data?.revokePublicDoc;
}

export async function grantMember(
  app: INestApplication,
  token: string,
  workspaceId: string,
  userId: string,
  permission: WorkspaceRole
) {
  const res = await request(app.getHttpServer())
    .post(gql)
    .auth(token, { type: 'bearer' })
    .set({ 'x-request-id': 'test', 'x-operation-name': 'test' })
    .send({
      query: `
          mutation {
            grantMember(
              workspaceId: "${workspaceId}"
              userId: "${userId}"
              permission: ${WorkspaceRole[permission]}
            )
          }
          `,
    })
    .expect(200);
  if (res.body.errors) {
    throw new Error(res.body.errors[0].message);
  }
  return res.body.data?.grantMember;
}

export async function revokeMember(
  app: INestApplication,
  token: string,
  workspaceId: string,
  userId: string
) {
  const res = await request(app.getHttpServer())
    .post(gql)
    .auth(token, { type: 'bearer' })
    .set({ 'x-request-id': 'test', 'x-operation-name': 'test' })
    .send({
      query: `
          mutation {
            revoke(workspaceId: "${workspaceId}", userId: "${userId}")
          }
          `,
    })
    .expect(200);
  if (res.body.errors) {
    throw new Error(res.body.errors[0].message);
  }
  return res.body.data?.revokeMember;
}
