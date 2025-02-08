import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { DocRole } from '../../core/permission/types';
import { gql } from './common';

export function grantDocUserRoles(
  app: INestApplication,
  token: string,
  workspaceId: string,
  docId: string,
  userIds: string[],
  role: DocRole
) {
  return request(app.getHttpServer())
    .post(gql)
    .auth(token, { type: 'bearer' })
    .set({ 'x-request-id': 'test', 'x-operation-name': 'test' })
    .send({
      query: `
        mutation {
          grantDocUserRoles(input: {
            workspaceId: "${workspaceId}",
            docId: "${docId}",
            userIds: ["${userIds.join('","')}"],
            role: ${DocRole[role]}
          })
        }
      `,
    });
}

export function revokeDocUserRoles(
  app: INestApplication,
  token: string,
  workspaceId: string,
  docId: string,
  userId: string
) {
  return request(app.getHttpServer())
    .post(gql)
    .auth(token, { type: 'bearer' })
    .set({ 'x-request-id': 'test', 'x-operation-name': 'test' })
    .send({
      query: `
        mutation {
          revokeDocUserRoles(input: {
            workspaceId: "${workspaceId}",
            docId: "${docId}",
            userId: "${userId}"
          })
        }
      `,
    });
}

export function updateDocDefaultRole(
  app: INestApplication,
  token: string,
  workspaceId: string,
  docId: string,
  role: DocRole
) {
  return request(app.getHttpServer())
    .post(gql)
    .auth(token, { type: 'bearer' })
    .set({ 'x-request-id': 'test', 'x-operation-name': 'test' })
    .send({
      query: `
        mutation {
          updateDocDefaultRole(input: {
            workspaceId: "${workspaceId}",
            docId: "${docId}",
            role: ${DocRole[role]}
          })
        }
      `,
    });
}

export async function docGrantedUsersList(
  app: INestApplication,
  token: string,
  workspaceId: string,
  docId: string,
  first = 10,
  offset = 0
) {
  const res = await request(app.getHttpServer())
    .post(gql)
    .auth(token, { type: 'bearer' })
    .set({ 'x-request-id': 'test', 'x-operation-name': 'test' })
    .send({
      query: `
        query {
          workspace(id: "${workspaceId}") {
            doc(docId: "${docId}") {
              grantedUsersList(pagination: { first: ${first}, offset: ${offset} }) {
                totalCount
                edges {
                cursor
                  node {
                    role
                    user {
                      id
                    }
                  }
                }
              }
            }
          }
        }
      `,
    });
  return res.body;
}
