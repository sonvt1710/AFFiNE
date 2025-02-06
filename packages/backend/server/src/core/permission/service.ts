import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaClient, WorkspaceMemberStatus } from '@prisma/client';
import { groupBy } from 'lodash-es';

import {
  DocAccessDenied,
  EventBus,
  OnEvent,
  SpaceAccessDenied,
  SpaceOwnerNotFound,
  SpaceShouldHaveOnlyOneOwner,
  WorkspacePermissionNotFound,
} from '../../base';
import {
  DocAction,
  docActionRequiredRole,
  docActionRequiredWorkspaceRole,
  DocRole,
  PublicPageMode,
  WorkspaceRole,
} from './types';

@Injectable()
export class PermissionService {
  private readonly logger = new Logger(PermissionService.name);

  constructor(
    private readonly prisma: PrismaClient,
    private readonly event: EventBus
  ) {}

  @OnEvent('doc.update.pushed')
  async onDocUpdatePushed(payload: Events['doc.update.pushed']) {
    const { workspaceId, docId, editor } = payload;

    await this.prisma.$queryRaw`
      INSERT INTO "workspace_page_user_permissions" ("workspace_id", "page_id", "user_id", "type", "created_at")
      VALUES (${workspaceId}, ${docId}, ${editor}, ${DocRole.Owner}, now())
      ON CONFLICT ("workspace_id", "page_id", "user_id")
      DO NOTHING
    `;
  }

  private get acceptedCondition() {
    return [
      {
        accepted: true,
      },
      {
        status: WorkspaceMemberStatus.Accepted,
      },
    ];
  }

  /// Start regin: workspace permission
  async get(ws: string, user: string): Promise<WorkspaceRole> {
    const data = await this.prisma.workspaceUserPermission.findFirst({
      where: {
        workspaceId: ws,
        userId: user,
        OR: this.acceptedCondition,
      },
    });

    if (!data) {
      throw new WorkspacePermissionNotFound({ spaceId: ws });
    }

    return data.type;
  }

  /**
   * check whether a workspace exists and has any one can access it
   * @param workspaceId workspace id
   * @returns
   */
  async hasWorkspace(workspaceId: string) {
    return await this.prisma.workspaceUserPermission
      .count({
        where: {
          workspaceId,
          OR: this.acceptedCondition,
        },
      })
      .then(count => count > 0);
  }

  async getOwnedWorkspaces(userId: string) {
    return this.prisma.workspaceUserPermission
      .findMany({
        where: {
          userId,
          type: WorkspaceRole.Owner,
          OR: this.acceptedCondition,
        },
        select: {
          workspaceId: true,
        },
      })
      .then(data => data.map(({ workspaceId }) => workspaceId));
  }

  async getWorkspaceOwner(workspaceId: string) {
    const owner = await this.prisma.workspaceUserPermission.findFirst({
      where: {
        workspaceId,
        type: WorkspaceRole.Owner,
      },
      include: {
        user: true,
      },
    });

    if (!owner) {
      throw new SpaceOwnerNotFound({ spaceId: workspaceId });
    }

    return owner.user;
  }

  async getWorkspaceAdmin(workspaceId: string) {
    const admin = await this.prisma.workspaceUserPermission.findMany({
      where: {
        workspaceId,
        type: WorkspaceRole.Admin,
      },
      include: {
        user: true,
      },
    });

    return admin.map(({ user }) => user);
  }

  async getWorkspaceMemberCount(workspaceId: string) {
    return this.prisma.workspaceUserPermission.count({
      where: {
        workspaceId,
      },
    });
  }

  async tryGetWorkspaceOwner(workspaceId: string) {
    return this.prisma.workspaceUserPermission.findFirst({
      where: {
        workspaceId,
        type: WorkspaceRole.Owner,
      },
      include: {
        user: true,
      },
    });
  }

  /**
   * check if a doc binary is accessible by a user
   */
  async isPublicAccessible(
    ws: string,
    id: string,
    user?: string
  ): Promise<boolean> {
    if (ws === id) {
      // if workspace is public or have any public page, then allow to access
      const [isPublicWorkspace, publicPages] = await Promise.all([
        this.tryCheckWorkspace(ws, user, WorkspaceRole.Collaborator),
        this.prisma.workspacePage.count({
          where: {
            workspaceId: ws,
            public: true,
          },
        }),
      ]);
      return isPublicWorkspace || publicPages > 0;
    }

    return this.tryCheckPage(ws, id, 'Doc.Read', user);
  }

  async getWorkspaceMemberStatus(ws: string, user: string) {
    return this.prisma.workspaceUserPermission
      .findFirst({
        where: {
          workspaceId: ws,
          userId: user,
        },
        select: { status: true },
      })
      .then(r => r?.status);
  }

  /**
   * Returns whether a given user is a member of a workspace and has the given or higher permission.
   */
  async isWorkspaceMember(
    ws: string,
    user: string,
    permission: WorkspaceRole = WorkspaceRole.Collaborator
  ): Promise<boolean> {
    const count = await this.prisma.workspaceUserPermission.count({
      where: {
        workspaceId: ws,
        userId: user,
        OR: this.acceptedCondition,
        type: {
          gte: permission,
        },
      },
    });

    return count !== 0;
  }

  /**
   * only check permission if the workspace is a cloud workspace
   * @param workspaceId workspace id
   * @param userId user id, check if is a public workspace if not provided
   * @param permission default is read
   */
  async checkCloudWorkspace(
    workspaceId: string,
    userId?: string,
    permission: WorkspaceRole = WorkspaceRole.Collaborator
  ) {
    const hasWorkspace = await this.hasWorkspace(workspaceId);
    if (hasWorkspace) {
      await this.checkWorkspace(workspaceId, userId, permission);
    }
  }

  async checkWorkspace(
    ws: string,
    user?: string,
    permission: WorkspaceRole = WorkspaceRole.Collaborator
  ) {
    if (!(await this.tryCheckWorkspace(ws, user, permission))) {
      throw new SpaceAccessDenied({ spaceId: ws });
    }
  }

  async tryCheckWorkspace(
    ws: string,
    user?: string,
    permission: WorkspaceRole = WorkspaceRole.Collaborator
  ) {
    // If the permission is read, we should check if the workspace is public
    if (permission === WorkspaceRole.Collaborator) {
      const count = await this.prisma.workspace.count({
        where: { id: ws, public: true },
      });

      // workspace is public
      // accessible
      if (count > 0) {
        return true;
      }
    }

    if (user) {
      // normally check if the user has the permission
      const count = await this.prisma.workspaceUserPermission.count({
        where: {
          workspaceId: ws,
          userId: user,
          OR: this.acceptedCondition,
          type: {
            gte: permission,
          },
        },
      });

      if (count > 0) {
        return true;
      } else {
        this.logger.log("User's WorkspaceRole is lower than required", {
          workspaceId: ws,
          userId: user,
          requiredRole: WorkspaceRole[permission],
        });
      }
    }

    // unsigned in, workspace is not public
    // unaccessible
    return false;
  }

  async checkWorkspaceIs(
    ws: string,
    user: string,
    permission: WorkspaceRole = WorkspaceRole.Collaborator
  ) {
    if (!(await this.tryCheckWorkspaceIs(ws, user, permission))) {
      throw new SpaceAccessDenied({ spaceId: ws });
    }
  }

  async tryCheckWorkspaceIs(
    ws: string,
    user: string,
    permission: WorkspaceRole = WorkspaceRole.Collaborator
  ) {
    const count = await this.prisma.workspaceUserPermission.count({
      where: {
        workspaceId: ws,
        userId: user,
        OR: this.acceptedCondition,
        type: permission,
      },
    });

    return count > 0;
  }

  async allowUrlPreview(ws: string) {
    const count = await this.prisma.workspace.count({
      where: {
        id: ws,
        enableUrlPreview: true,
      },
    });

    return count > 0;
  }

  private getAllowedStatusSource(
    to: WorkspaceMemberStatus
  ): WorkspaceMemberStatus[] {
    switch (to) {
      case WorkspaceMemberStatus.NeedMoreSeat:
        return [WorkspaceMemberStatus.Pending];
      case WorkspaceMemberStatus.NeedMoreSeatAndReview:
        return [WorkspaceMemberStatus.UnderReview];
      case WorkspaceMemberStatus.Pending:
      case WorkspaceMemberStatus.UnderReview:
        return [WorkspaceMemberStatus.Accepted];
      default:
        return [];
    }
  }

  async grant(
    ws: string,
    user: string,
    permission: WorkspaceRole = WorkspaceRole.Collaborator,
    status: WorkspaceMemberStatus = WorkspaceMemberStatus.Pending
  ): Promise<string> {
    const data = await this.prisma.workspaceUserPermission.findFirst({
      where: { workspaceId: ws, userId: user },
    });

    if (data) {
      const toBeOwner = permission === WorkspaceRole.Owner;
      if (data.accepted && data.status === WorkspaceMemberStatus.Accepted) {
        const [p] = await this.prisma.$transaction(
          [
            this.prisma.workspaceUserPermission.update({
              where: {
                workspaceId_userId: { workspaceId: ws, userId: user },
              },
              data: { type: permission },
            }),

            // If the new permission is owner, we need to revoke old owner
            toBeOwner
              ? this.prisma.workspaceUserPermission.updateMany({
                  where: {
                    workspaceId: ws,
                    type: WorkspaceRole.Owner,
                    userId: { not: user },
                  },
                  data: { type: WorkspaceRole.Admin },
                })
              : null,
          ].filter(Boolean) as Prisma.PrismaPromise<any>[]
        );

        return p.id;
      }
      const allowedStatus = this.getAllowedStatusSource(data.status);
      if (allowedStatus.includes(status)) {
        const ret = await this.prisma.workspaceUserPermission.update({
          where: { workspaceId_userId: { workspaceId: ws, userId: user } },
          data: { status },
        });
        return ret.id;
      }
      return data.id;
    }

    return this.prisma.workspaceUserPermission
      .create({
        data: {
          workspaceId: ws,
          userId: user,
          type: permission,
          status,
        },
      })
      .then(p => p.id);
  }

  async acceptWorkspaceInvitation(
    invitationId: string,
    workspaceId: string,
    status: WorkspaceMemberStatus = WorkspaceMemberStatus.Accepted
  ) {
    const result = await this.prisma.workspaceUserPermission.updateMany({
      where: {
        id: invitationId,
        workspaceId: workspaceId,
        AND: [{ accepted: false }, { status: WorkspaceMemberStatus.Pending }],
      },
      data: { accepted: true, status },
    });

    return result.count > 0;
  }

  async refreshSeatStatus(workspaceId: string, memberLimit: number) {
    const usedCount = await this.prisma.workspaceUserPermission.count({
      where: { workspaceId, status: WorkspaceMemberStatus.Accepted },
    });

    const availableCount = memberLimit - usedCount;

    if (availableCount <= 0) {
      return;
    }

    await this.prisma.$transaction(async tx => {
      const members = await tx.workspaceUserPermission.findMany({
        select: { id: true, status: true },
        where: {
          workspaceId,
          status: {
            in: [
              WorkspaceMemberStatus.NeedMoreSeat,
              WorkspaceMemberStatus.NeedMoreSeatAndReview,
            ],
          },
        },
        orderBy: { createdAt: 'asc' },
      });

      const needChange = members.slice(0, availableCount);
      const { NeedMoreSeat, NeedMoreSeatAndReview } = groupBy(
        needChange,
        m => m.status
      );

      const toPendings = NeedMoreSeat ?? [];
      if (toPendings.length > 0) {
        await tx.workspaceUserPermission.updateMany({
          where: { id: { in: toPendings.map(m => m.id) } },
          data: { status: WorkspaceMemberStatus.Pending },
        });
      }

      const toUnderReviewUserIds = NeedMoreSeatAndReview ?? [];
      if (toUnderReviewUserIds.length > 0) {
        await tx.workspaceUserPermission.updateMany({
          where: { id: { in: toUnderReviewUserIds.map(m => m.id) } },
          data: { status: WorkspaceMemberStatus.UnderReview },
        });
      }

      return [toPendings, toUnderReviewUserIds] as const;
    });
  }

  async revokeWorkspace(workspaceId: string, user: string) {
    const permission = await this.prisma.workspaceUserPermission.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: user } },
    });

    // We shouldn't revoke owner permission
    // should auto deleted by workspace/user delete cascading
    if (!permission || permission.type === WorkspaceRole.Owner) {
      return false;
    }

    await this.prisma.workspaceUserPermission.deleteMany({
      where: {
        workspaceId,
        userId: user,
      },
    });

    const count = await this.prisma.workspaceUserPermission.count({
      where: { workspaceId },
    });

    this.event.emit('workspace.members.updated', {
      workspaceId,
      count,
    });
    this.event.emit('workspace.members.removed', {
      workspaceId,
      userId: user,
    });

    if (
      permission.status === 'UnderReview' ||
      permission.status === 'NeedMoreSeatAndReview'
    ) {
      this.event.emit('workspace.members.requestDeclined', {
        userId: user,
        workspaceId,
      });
    }

    return true;
  }
  /// End regin: workspace permission

  /// Start regin: page permission
  /**
   * only check permission if the workspace is a cloud workspace
   * @param workspaceId workspace id
   * @param pageId page id aka doc id
   * @param userId user id, check if is a public page if not provided
   * @param permission default is read
   */
  async checkCloudPagePermission(
    workspaceId: string,
    pageId: string,
    action: DocAction,
    userId?: string
  ) {
    const hasWorkspace = await this.hasWorkspace(workspaceId);
    if (hasWorkspace) {
      await this.checkPagePermission(workspaceId, pageId, action, userId);
    }
  }

  async checkPagePermission(
    ws: string,
    page: string,
    action: DocAction,
    user?: string
  ) {
    if (!(await this.tryCheckPage(ws, page, action, user))) {
      throw new DocAccessDenied({ spaceId: ws, docId: page });
    }
  }

  async tryCheckPage(
    ws: string,
    page: string,
    action: DocAction,
    user?: string
  ) {
    const role = docActionRequiredRole(action);
    // check whether page is public
    if (action === 'Doc.Read') {
      const count = await this.prisma.workspacePage.count({
        where: {
          workspaceId: ws,
          pageId: page,
          public: true,
        },
      });

      // page is public
      // accessible
      if (count > 0) {
        return true;
      }
    }

    if (user) {
      const count = await this.prisma.workspacePageUserPermission.count({
        where: {
          workspaceId: ws,
          pageId: page,
          userId: user,
          type: {
            gte: role,
          },
        },
      });

      // page shared to user
      // accessible
      if (count > 0) {
        return true;
      } else {
        this.logger.log("User's PageRole is lower than required", {
          workspaceId: ws,
          pageId: page,
          userId: user,
          requiredRole: DocRole[role],
          action,
        });
      }
    }

    // check whether user has workspace related permission
    return this.tryCheckWorkspace(
      ws,
      user,
      docActionRequiredWorkspaceRole(action)
    );
  }

  async isPublicPage(ws: string, page: string) {
    return this.prisma.workspacePage
      .count({
        where: {
          workspaceId: ws,
          pageId: page,
          public: true,
        },
      })
      .then(count => count > 0);
  }

  async publishPage(ws: string, page: string, mode = PublicPageMode.Page) {
    return this.prisma.workspacePage.upsert({
      where: {
        workspaceId_pageId: {
          workspaceId: ws,
          pageId: page,
        },
      },
      update: {
        public: true,
        mode,
      },
      create: {
        workspaceId: ws,
        pageId: page,
        mode,
        public: true,
      },
    });
  }

  async revokePublicPage(ws: string, page: string) {
    return this.prisma.workspacePage.upsert({
      where: {
        workspaceId_pageId: {
          workspaceId: ws,
          pageId: page,
        },
      },
      update: {
        public: false,
      },
      create: {
        workspaceId: ws,
        pageId: page,
        public: false,
      },
    });
  }

  async grantPage(ws: string, page: string, user: string, permission: DocRole) {
    const [p] = await this.prisma.$transaction(
      [
        this.prisma.workspacePageUserPermission.upsert({
          where: {
            workspaceId_pageId_userId: {
              workspaceId: ws,
              pageId: page,
              userId: user,
            },
          },
          update: {
            type: permission,
          },
          create: {
            workspaceId: ws,
            pageId: page,
            userId: user,
            type: permission,
          },
        }),

        // If the new permission is owner, we need to revoke old owner
        permission === DocRole.Owner
          ? this.prisma.workspacePageUserPermission.updateMany({
              where: {
                workspaceId: ws,
                pageId: page,
                type: DocRole.Owner,
                userId: {
                  not: user,
                },
              },
              data: {
                type: DocRole.Manager,
              },
            })
          : null,
      ].filter(Boolean) as Prisma.PrismaPromise<any>[]
    );

    return p;
  }

  async revokePage(ws: string, page: string, users: string[]) {
    const result = await this.prisma.workspacePageUserPermission.deleteMany({
      where: {
        workspaceId: ws,
        pageId: page,
        userId: {
          in: users,
        },
        type: {
          // We shouldn't revoke owner permission, should auto deleted by workspace/user delete cascading
          not: DocRole.Owner,
        },
      },
    });

    return result.count > 0;
  }

  async grantPagePermission(
    workspaceId: string,
    pageId: string,
    userIds: string[],
    role: DocRole
  ) {
    if (userIds.length === 0) {
      return [];
    }
    if (role === DocRole.Owner && userIds.length > 1) {
      throw new SpaceShouldHaveOnlyOneOwner({ spaceId: workspaceId });
    }

    return await this.prisma.$transaction(async tx =>
      Promise.all(
        userIds.map(id =>
          tx.workspacePageUserPermission.upsert({
            where: {
              workspaceId_pageId_userId: {
                workspaceId,
                pageId,
                userId: id,
              },
            },
            create: {
              workspaceId,
              pageId,
              userId: id,
              type: role,
            },
            update: {
              type: role,
            },
          })
        )
      )
    );
  }

  async updatePagePermission(
    workspaceId: string,
    pageId: string,
    userId: string,
    role: DocRole
  ) {
    const permission = await this.prisma.workspacePageUserPermission.findFirst({
      where: {
        workspaceId,
        pageId,
        userId,
      },
    });

    if (!permission) {
      return this.grantPage(workspaceId, pageId, userId, role);
    }

    return await this.prisma.workspacePageUserPermission.update({
      where: {
        workspaceId_pageId_userId: {
          workspaceId,
          pageId,
          userId,
        },
      },
      data: {
        type: role,
      },
    });
  }
}
