/// <reference types="../global.d.ts" />

import { randomUUID } from 'node:crypto';

import { getCurrentMailMessageCount } from '@affine-test/kit/utils/cloud';
import { WorkspaceMemberStatus } from '@prisma/client';
import type { TestFn } from 'ava';
import ava from 'ava';
import { nanoid } from 'nanoid';
import Sinon from 'sinon';
import request from 'supertest';

import { AppModule } from '../app.module';
import { EventBus } from '../base';
import { AuthService } from '../core/auth';
import { DocContentService } from '../core/doc-renderer';
import { DocRole, PermissionService, WorkspaceRole } from '../core/permission';
import { WorkspaceType } from '../core/workspaces';
import { Models } from '../models';
import {
  acceptInviteById,
  approveMember,
  createInviteLink,
  createTestingApp,
  createWorkspace,
  docGrantedUsersList,
  getInviteInfo,
  getInviteLink,
  getWorkspace,
  grantDocUserRoles,
  grantMember,
  inviteUser,
  inviteUsers,
  leaveWorkspace,
  revokeDocUserRoles,
  revokeInviteLink,
  revokeMember,
  revokeUser,
  signUp,
  sleep,
  TestingApp,
  updateDocDefaultRole,
  UserAuthedType,
} from './utils';

const test = ava as TestFn<{
  app: TestingApp;
  auth: AuthService;
  event: Sinon.SinonStubbedInstance<EventBus>;
  models: Models;
  permissions: PermissionService;
}>;

test.before(async t => {
  const { app } = await createTestingApp({
    imports: [AppModule],
    tapModule: module => {
      module
        .overrideProvider(EventBus)
        .useValue(Sinon.createStubInstance(EventBus));
      module.overrideProvider(DocContentService).useValue({
        getWorkspaceContent() {
          return {
            name: 'test',
            avatarKey: null,
          };
        },
      });
    },
  });

  t.context.app = app;
  t.context.auth = app.get(AuthService);
  t.context.event = app.get(EventBus);
  t.context.models = app.get(Models);
  t.context.permissions = app.get(PermissionService);
});

test.beforeEach(async t => {
  await t.context.app.initTestingDB();
});

test.after.always(async t => {
  await t.context.app.close();
});

const init = async (
  app: TestingApp,
  memberLimit = 10,
  prefix = randomUUID()
) => {
  const owner = await signUp(
    app,
    'owner',
    `${prefix}owner@affine.pro`,
    '123456'
  );
  const models = app.get(Models);
  {
    await models.userFeature.add(owner.id, 'pro_plan_v1', 'test');
  }

  const workspace = await createWorkspace(app, owner.token.token);
  const teamWorkspace = await createWorkspace(app, owner.token.token);
  {
    models.workspaceFeature.add(teamWorkspace.id, 'team_plan_v1', 'test', {
      memberLimit,
    });
  }

  const invite = async (
    email: string,
    permission: WorkspaceRole = WorkspaceRole.Collaborator,
    shouldSendEmail: boolean = false
  ) => {
    const member = await signUp(app, email.split('@')[0], email, '123456');

    {
      // normal workspace
      const inviteId = await inviteUser(
        app,
        owner.token.token,
        workspace.id,
        member.email,
        shouldSendEmail
      );
      await acceptInviteById(app, workspace.id, inviteId, shouldSendEmail);
    }

    {
      // team workspace
      const inviteId = await inviteUser(
        app,
        owner.token.token,
        teamWorkspace.id,
        member.email,
        shouldSendEmail
      );
      await acceptInviteById(app, teamWorkspace.id, inviteId, shouldSendEmail);
      await grantMember(
        app,
        owner.token.token,
        teamWorkspace.id,
        member.id,
        permission
      );
    }

    return member;
  };

  const inviteBatch = async (
    emails: string[],
    shouldSendEmail: boolean = false
  ) => {
    const members = [];
    for (const email of emails) {
      const member = await signUp(app, email.split('@')[0], email, '123456');
      members.push(member);
    }
    const invites = await inviteUsers(
      app,
      owner.token.token,
      teamWorkspace.id,
      emails,
      shouldSendEmail
    );
    return [members, invites] as const;
  };

  const getCreateInviteLinkFetcher = async (ws: WorkspaceType) => {
    const { link } = await createInviteLink(
      app,
      owner.token.token,
      ws.id,
      'OneDay'
    );
    const inviteId = link.split('/').pop()!;
    return [
      inviteId,
      async (
        email: string,
        shouldSendEmail: boolean = false
      ): Promise<UserAuthedType> => {
        const member = await signUp(app, email.split('@')[0], email, '123456');
        await acceptInviteById(
          app,
          ws.id,
          inviteId,
          shouldSendEmail,
          member.token.token
        );
        return member;
      },
      async (token: string) => {
        await acceptInviteById(app, ws.id, inviteId, false, token);
      },
    ] as const;
  };

  const admin = await invite(`${prefix}admin@affine.pro`, WorkspaceRole.Admin);
  const write = await invite(`${prefix}write@affine.pro`);
  const read = await invite(
    `${prefix}read@affine.pro`,
    WorkspaceRole.Collaborator
  );

  const external = await invite(
    `${prefix}external@affine.pro`,
    WorkspaceRole.External
  );

  return {
    invite,
    inviteBatch,
    createInviteLink: getCreateInviteLinkFetcher,
    owner,
    workspace,
    teamWorkspace,
    admin,
    write,
    read,
    external,
  };
};

test('should be able to invite multiple users', async t => {
  const { app } = t.context;
  const { teamWorkspace: ws, owner, admin, write, read } = await init(app, 5);

  {
    // no permission
    await t.throwsAsync(
      inviteUsers(app, read.token.token, ws.id, ['test@affine.pro']),
      { instanceOf: Error },
      'should throw error if not manager'
    );
    await t.throwsAsync(
      inviteUsers(app, write.token.token, ws.id, ['test@affine.pro']),
      { instanceOf: Error },
      'should throw error if not manager'
    );
  }

  {
    // manager
    const m1 = await signUp(app, 'm1', 'm1@affine.pro', '123456');
    const m2 = await signUp(app, 'm2', 'm2@affine.pro', '123456');
    t.is(
      (await inviteUsers(app, owner.token.token, ws.id, [m1.email])).length,
      1,
      'should be able to invite user'
    );
    t.is(
      (await inviteUsers(app, admin.token.token, ws.id, [m2.email])).length,
      1,
      'should be able to invite user'
    );
    t.is(
      (await inviteUsers(app, admin.token.token, ws.id, [m2.email])).length,
      0,
      'should not be able to invite user if already in workspace'
    );

    await t.throwsAsync(
      inviteUsers(
        app,
        admin.token.token,
        ws.id,
        Array.from({ length: 513 }, (_, i) => `m${i}@affine.pro`)
      ),
      { message: 'Too many requests.' },
      'should throw error if exceed maximum number of invitations per request'
    );
  }
});

test('should be able to check seat limit', async t => {
  const { app, permissions, models } = t.context;
  const { invite, inviteBatch, teamWorkspace: ws } = await init(app, 5);

  {
    // invite
    await t.throwsAsync(
      invite('member3@affine.pro', WorkspaceRole.Collaborator),
      { message: 'You have exceeded your workspace member quota.' },
      'should throw error if exceed member limit'
    );
    models.workspaceFeature.add(ws.id, 'team_plan_v1', 'test', {
      memberLimit: 6,
    });
    await t.notThrowsAsync(
      invite('member4@affine.pro', WorkspaceRole.Collaborator),
      'should not throw error if not exceed member limit'
    );
  }

  {
    const members1 = inviteBatch(['member5@affine.pro']);
    // invite batch
    await t.notThrowsAsync(
      members1,
      'should not throw error in batch invite event reach limit'
    );

    t.is(
      await permissions.getWorkspaceMemberStatus(
        ws.id,
        (await members1)[0][0].id
      ),
      WorkspaceMemberStatus.NeedMoreSeat,
      'should be able to check member status'
    );

    // refresh seat, fifo
    sleep(1000);
    const [[members2]] = await inviteBatch(['member6@affine.pro']);
    await permissions.refreshSeatStatus(ws.id, 7);

    t.is(
      await permissions.getWorkspaceMemberStatus(
        ws.id,
        (await members1)[0][0].id
      ),
      WorkspaceMemberStatus.Pending,
      'should become accepted after refresh'
    );
    t.is(
      await permissions.getWorkspaceMemberStatus(ws.id, members2.id),
      WorkspaceMemberStatus.NeedMoreSeat,
      'should not change status'
    );
  }
});

test('should be able to grant team member permission', async t => {
  const { app, permissions } = t.context;
  const { owner, teamWorkspace: ws, write, read } = await init(app);

  await t.throwsAsync(
    grantMember(
      app,
      read.token.token,
      ws.id,
      write.id,
      WorkspaceRole.Collaborator
    ),
    { instanceOf: Error },
    'should throw error if not owner'
  );
  await t.throwsAsync(
    grantMember(
      app,
      write.token.token,
      ws.id,
      read.id,
      WorkspaceRole.Collaborator
    ),
    { instanceOf: Error },
    'should throw error if not owner'
  );
  await t.throwsAsync(
    grantMember(
      app,
      write.token.token,
      ws.id,
      read.id,
      WorkspaceRole.Collaborator
    ),
    { instanceOf: Error },
    'should throw error if not admin'
  );

  {
    // owner should be able to grant permission
    t.true(
      await permissions.tryCheckWorkspaceIs(
        ws.id,
        read.id,
        WorkspaceRole.Collaborator
      ),
      'should be able to check permission'
    );
    t.truthy(
      await grantMember(
        app,
        owner.token.token,
        ws.id,
        read.id,
        WorkspaceRole.Admin
      ),
      'should be able to grant permission'
    );
    t.true(
      await permissions.tryCheckWorkspaceIs(
        ws.id,
        read.id,
        WorkspaceRole.Admin
      ),
      'should be able to check permission'
    );
  }
});

test('should be able to leave workspace', async t => {
  const { app } = t.context;
  const { owner, teamWorkspace: ws, admin, write, read } = await init(app);

  t.false(
    await leaveWorkspace(app, owner.token.token, ws.id),
    'owner should not be able to leave workspace'
  );
  t.true(
    await leaveWorkspace(app, admin.token.token, ws.id),
    'admin should be able to leave workspace'
  );
  t.true(
    await leaveWorkspace(app, write.token.token, ws.id),
    'write should be able to leave workspace'
  );
  t.true(
    await leaveWorkspace(app, read.token.token, ws.id),
    'read should be able to leave workspace'
  );
});

test('should be able to revoke team member', async t => {
  const { app } = t.context;
  const { teamWorkspace: ws, owner, admin, write, read } = await init(app);

  {
    // no permission
    await t.throwsAsync(
      revokeUser(app, read.token.token, ws.id, read.id),
      { instanceOf: Error },
      'should throw error if not admin'
    );
    await t.throwsAsync(
      revokeUser(app, read.token.token, ws.id, write.id),
      { instanceOf: Error },
      'should throw error if not admin'
    );
  }

  {
    // manager
    t.true(
      await revokeUser(app, admin.token.token, ws.id, read.id),
      'admin should be able to revoke member'
    );

    t.true(
      await revokeUser(app, owner.token.token, ws.id, write.id),
      'owner should be able to revoke member'
    );

    await t.throwsAsync(
      revokeUser(app, admin.token.token, ws.id, admin.id),
      { instanceOf: Error },
      'should not be able to revoke themselves'
    );

    t.false(
      await revokeUser(app, owner.token.token, ws.id, owner.id),
      'should not be able to revoke themselves'
    );

    await revokeUser(app, owner.token.token, ws.id, admin.id);
    await t.throwsAsync(
      revokeUser(app, admin.token.token, ws.id, read.id),
      { instanceOf: Error },
      'should not be able to revoke member not in workspace'
    );
  }
});

test('should be able to manage invite link', async t => {
  const { app } = t.context;
  const {
    workspace: ws,
    teamWorkspace: tws,
    owner,
    admin,
    write,
    read,
  } = await init(app);

  for (const [workspace, managers] of [
    [ws, [owner]],
    [tws, [owner, admin]],
  ] as const) {
    for (const manager of managers) {
      const { link } = await createInviteLink(
        app,
        manager.token.token,
        workspace.id,
        'OneDay'
      );
      const { link: currLink } = await getInviteLink(
        app,
        manager.token.token,
        workspace.id
      );
      t.is(link, currLink, 'should be able to get invite link');

      t.true(
        await revokeInviteLink(app, manager.token.token, workspace.id),
        'should be able to revoke invite link'
      );
    }

    for (const collaborator of [write, read]) {
      await t.throwsAsync(
        createInviteLink(app, collaborator.token.token, workspace.id, 'OneDay'),
        { instanceOf: Error },
        'should throw error if not manager'
      );
      await t.throwsAsync(
        getInviteLink(app, collaborator.token.token, workspace.id),
        { instanceOf: Error },
        'should throw error if not manager'
      );
      await t.throwsAsync(
        revokeInviteLink(app, collaborator.token.token, workspace.id),
        { instanceOf: Error },
        'should throw error if not manager'
      );
    }
  }
});

test('should be able to approve team member', async t => {
  const { app } = t.context;
  const { teamWorkspace: tws, owner, admin, write, read } = await init(app, 6);

  {
    const { link } = await createInviteLink(
      app,
      owner.token.token,
      tws.id,
      'OneDay'
    );
    const inviteId = link.split('/').pop()!;

    const member = await signUp(
      app,
      'newmember',
      'newmember@affine.pro',
      '123456'
    );
    t.true(
      await acceptInviteById(app, tws.id, inviteId, false, member.token.token),
      'should be able to accept invite'
    );

    const { members } = await getWorkspace(app, owner.token.token, tws.id);
    const memberInvite = members.find(m => m.id === member.id)!;
    t.is(memberInvite.status, 'UnderReview', 'should be under review');

    t.is(
      await approveMember(app, admin.token.token, tws.id, member.id),
      memberInvite.inviteId
    );
  }

  {
    await t.throwsAsync(
      approveMember(app, admin.token.token, tws.id, 'not_exists_id'),
      { instanceOf: Error },
      'should throw error if member not exists'
    );
    await t.throwsAsync(
      approveMember(app, write.token.token, tws.id, 'not_exists_id'),
      { instanceOf: Error },
      'should throw error if not manager'
    );
    await t.throwsAsync(
      approveMember(app, read.token.token, tws.id, 'not_exists_id'),
      { instanceOf: Error },
      'should throw error if not manager'
    );
  }
});

test('should be able to invite by link', async t => {
  const { app, permissions, models } = t.context;
  const {
    createInviteLink,
    owner,
    workspace: ws,
    teamWorkspace: tws,
  } = await init(app, 5);
  const [inviteId, invite] = await createInviteLink(ws);
  const [teamInviteId, teamInvite, acceptTeamInvite] =
    await createInviteLink(tws);

  {
    // check invite link
    const info = await getInviteInfo(app, owner.token.token, inviteId);
    t.is(info.workspace.id, ws.id, 'should be able to get invite info');

    // check team invite link
    const teamInfo = await getInviteInfo(app, owner.token.token, teamInviteId);
    t.is(teamInfo.workspace.id, tws.id, 'should be able to get invite info');
  }

  {
    // invite link
    for (const [i] of Array.from({ length: 5 }).entries()) {
      const user = await invite(`test${i}@affine.pro`);
      const status = await permissions.getWorkspaceMemberStatus(ws.id, user.id);
      t.is(
        status,
        WorkspaceMemberStatus.Accepted,
        'should be able to check status'
      );
    }

    await t.throwsAsync(
      invite('exceed@affine.pro'),
      { message: 'You have exceeded your workspace member quota.' },
      'should throw error if exceed member limit'
    );
  }

  {
    // team invite link
    const members: UserAuthedType[] = [];
    await t.notThrowsAsync(async () => {
      members.push(await teamInvite('member3@affine.pro'));
      members.push(await teamInvite('member4@affine.pro'));
    }, 'should not throw error even exceed member limit');
    const [m3, m4] = members;

    t.is(
      await permissions.getWorkspaceMemberStatus(tws.id, m3.id),
      WorkspaceMemberStatus.NeedMoreSeatAndReview,
      'should not change status'
    );
    t.is(
      await permissions.getWorkspaceMemberStatus(tws.id, m4.id),
      WorkspaceMemberStatus.NeedMoreSeatAndReview,
      'should not change status'
    );

    models.workspaceFeature.add(tws.id, 'team_plan_v1', 'test', {
      memberLimit: 6,
    });
    await permissions.refreshSeatStatus(tws.id, 6);
    t.is(
      await permissions.getWorkspaceMemberStatus(tws.id, m3.id),
      WorkspaceMemberStatus.UnderReview,
      'should not change status'
    );
    t.is(
      await permissions.getWorkspaceMemberStatus(tws.id, m4.id),
      WorkspaceMemberStatus.NeedMoreSeatAndReview,
      'should not change status'
    );

    models.workspaceFeature.add(tws.id, 'team_plan_v1', 'test', {
      memberLimit: 7,
    });
    await permissions.refreshSeatStatus(tws.id, 7);
    t.is(
      await permissions.getWorkspaceMemberStatus(tws.id, m4.id),
      WorkspaceMemberStatus.UnderReview,
      'should not change status'
    );

    {
      const message = `You have already joined in Space ${tws.id}.`;
      await t.throwsAsync(
        acceptTeamInvite(owner.token.token),
        { message },
        'should throw error if member already in workspace'
      );
    }
  }
});

test('should be able to send mails', async t => {
  const { app } = t.context;
  const { inviteBatch } = await init(app, 5);
  const primitiveMailCount = await getCurrentMailMessageCount();

  {
    await inviteBatch(['m3@affine.pro', 'm4@affine.pro'], true);
    t.is(await getCurrentMailMessageCount(), primitiveMailCount + 2);
  }
});

test('should be able to emit events', async t => {
  const { app, event } = t.context;

  {
    const { teamWorkspace: tws, inviteBatch } = await init(app, 5);

    await inviteBatch(['m1@affine.pro', 'm2@affine.pro']);
    const [membersUpdated] = event.emit
      .getCalls()
      .map(call => call.args)
      .toReversed();
    t.deepEqual(membersUpdated, [
      'workspace.members.updated',
      {
        workspaceId: tws.id,
        count: 7,
      },
    ]);
  }

  {
    const { teamWorkspace: tws, owner, createInviteLink } = await init(app);
    const [, invite] = await createInviteLink(tws);
    const user = await invite('m3@affine.pro');
    const { members } = await getWorkspace(app, owner.token.token, tws.id);
    const memberInvite = members.find(m => m.id === user.id)!;
    t.deepEqual(
      event.emit.lastCall.args,
      [
        'workspace.members.reviewRequested',
        { inviteId: memberInvite.inviteId },
      ],
      'should emit review requested event'
    );

    await revokeUser(app, owner.token.token, tws.id, user.id);
    t.deepEqual(
      event.emit.lastCall.args,
      [
        'workspace.members.requestDeclined',
        { userId: user.id, workspaceId: tws.id },
      ],
      'should emit review requested event'
    );
  }

  {
    const { teamWorkspace: tws, owner, read } = await init(app);
    await grantMember(
      app,
      owner.token.token,
      tws.id,
      read.id,
      WorkspaceRole.Admin
    );
    t.deepEqual(
      event.emit.lastCall.args,
      [
        'workspace.members.roleChanged',
        {
          userId: read.id,
          workspaceId: tws.id,
          permission: WorkspaceRole.Admin,
        },
      ],
      'should emit role changed event'
    );

    await grantMember(
      app,
      owner.token.token,
      tws.id,
      read.id,
      WorkspaceRole.Owner
    );
    const [ownershipTransferred] = event.emit
      .getCalls()
      .map(call => call.args)
      .toReversed();
    t.deepEqual(
      ownershipTransferred,
      [
        'workspace.members.ownershipTransferred',
        { from: owner.id, to: read.id, workspaceId: tws.id },
      ],
      'should emit owner transferred event'
    );

    await revokeMember(app, read.token.token, tws.id, owner.id);
    const [memberRemoved, memberUpdated] = event.emit
      .getCalls()
      .map(call => call.args)
      .toReversed();
    t.deepEqual(
      memberRemoved,
      [
        'workspace.members.removed',
        {
          userId: owner.id,
          workspaceId: tws.id,
        },
      ],
      'should emit owner transferred event'
    );
    t.deepEqual(
      memberUpdated,
      [
        'workspace.members.updated',
        {
          count: 4,
          workspaceId: tws.id,
        },
      ],
      'should emit role changed event'
    );
  }
});

test('should be able to grant and revoke users role in page', async t => {
  const { app } = t.context;
  const {
    teamWorkspace: ws,
    admin,
    write,
    read,
    external,
  } = await init(app, 5);
  const docId = nanoid();

  const res = await grantDocUserRoles(
    app,
    admin.token.token,
    ws.id,
    docId,
    [read.id, write.id],
    DocRole.Manager
  );

  t.deepEqual(res.body, {
    data: {
      grantDocUserRoles: true,
    },
  });

  // should not downgrade the role if role exists
  {
    await grantDocUserRoles(
      app,
      admin.token.token,
      ws.id,
      docId,
      [read.id],
      DocRole.Reader
    );
    // read still be the Manager of this doc
    const res = await grantDocUserRoles(
      app,
      read.token.token,
      ws.id,
      docId,
      [external.id],
      DocRole.Editor
    );
    t.deepEqual(res.body, {
      data: {
        grantDocUserRoles: true,
      },
    });

    const docUsersList = await docGrantedUsersList(
      app,
      admin.token.token,
      ws.id,
      docId
    );
    t.is(docUsersList.data.workspace.doc.grantedUsersList.totalCount, 3);
    const externalRole =
      docUsersList.data.workspace.doc.grantedUsersList.edges.find(
        (edge: any) => edge.node.user.id === external.id
      )?.node.role;
    t.is(externalRole, DocRole[DocRole.Editor]);
  }
});

test('should be able to change the default role in page', async t => {
  const { app } = t.context;
  const { teamWorkspace: ws, admin } = await init(app, 5);
  const docId = nanoid();
  const res = await updateDocDefaultRole(
    app,
    admin.token.token,
    ws.id,
    docId,
    DocRole.Reader
  );

  t.deepEqual(res.body, {
    data: {
      updateDocDefaultRole: true,
    },
  });
});

test('default page role should be able to override the workspace role', async t => {
  const { app } = t.context;
  const {
    teamWorkspace: workspace,
    admin,
    read,
    external,
  } = await init(app, 5);

  const docId = nanoid();

  const res = await updateDocDefaultRole(
    app,
    admin.token.token,
    workspace.id,
    docId,
    DocRole.Manager
  );

  t.deepEqual(res.body, {
    data: {
      updateDocDefaultRole: true,
    },
  });

  // reader can manage the page if the page default role is Manager
  {
    const readerRes = await updateDocDefaultRole(
      app,
      read.token.token,
      workspace.id,
      docId,
      DocRole.Manager
    );

    t.deepEqual(readerRes.body, {
      data: {
        updateDocDefaultRole: true,
      },
    });
  }

  // external can't manage the page even if the page default role is Manager
  {
    const externalRes = await updateDocDefaultRole(
      app,
      external.token.token,
      workspace.id,
      docId,
      DocRole.Manager
    );

    t.like(externalRes.body, {
      errors: [
        {
          message: `You do not have permission to access doc ${docId} under Space ${workspace.id}.`,
        },
      ],
    });
  }
});

test('should be able to grant and revoke doc user role', async t => {
  const { app } = t.context;
  const { teamWorkspace: ws, admin, read, external } = await init(app, 5);
  const docId = nanoid();

  const res = await grantDocUserRoles(
    app,
    admin.token.token,
    ws.id,
    docId,
    [external.id],
    DocRole.Manager
  );

  t.deepEqual(res.body, {
    data: {
      grantDocUserRoles: true,
    },
  });

  // external user now can manage the page
  {
    const externalRes = await grantDocUserRoles(
      app,
      external.token.token,
      ws.id,
      docId,
      [read.id],
      DocRole.Manager
    );

    t.deepEqual(externalRes.body, {
      data: {
        grantDocUserRoles: true,
      },
    });
  }

  // revoke the role of the external user
  {
    const revokeRes = await revokeDocUserRoles(
      app,
      admin.token.token,
      ws.id,
      docId,
      external.id
    );

    t.deepEqual(revokeRes.body, {
      data: {
        revokeDocUserRoles: true,
      },
    });

    // external user can't manage the page
    const externalRes = await revokeDocUserRoles(
      app,
      external.token.token,
      ws.id,
      docId,
      read.id
    );

    t.like(externalRes.body, {
      errors: [
        {
          message: `You do not have permission to access doc ${docId} under Space ${ws.id}.`,
        },
      ],
    });
  }
});

test('update page default role should throw error if the space does not exist', async t => {
  const { app } = t.context;
  const { admin } = await init(app, 5);
  const docId = nanoid();
  const nonExistWorkspaceId = 'non-exist-workspace';
  const res = await request(app.getHttpServer())
    .post('/graphql')
    .auth(admin.token.token, { type: 'bearer' })
    .set({ 'x-request-id': 'test', 'x-operation-name': 'test' })
    .send({
      query: `
          mutation {
            updateDocDefaultRole(input: {
              workspaceId: "${nonExistWorkspaceId}",
              docId: "${docId}",
              role: Manager,
            })
          }
        `,
    })
    .expect(200);
  t.like(res.body, {
    errors: [
      {
        message: `You do not have permission to access doc ${docId} under Space ${nonExistWorkspaceId}.`,
      },
    ],
  });
});
