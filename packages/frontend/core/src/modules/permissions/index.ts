export type { Member } from './entities/members';
export {
  DocGrantedUsersService,
  type GrantedUser,
} from './services/doc-granted-users';
export { MemberSearchService } from './services/member-search';
export { WorkspaceMembersService } from './services/members';
export { WorkspacePermissionService } from './services/permission';

import { type Framework } from '@toeverything/infra';

import { WorkspaceServerService } from '../cloud';
import { DocScope, DocService } from '../doc';
import {
  WorkspaceScope,
  WorkspaceService,
  WorkspacesService,
} from '../workspace';
import { WorkspaceMembers } from './entities/members';
import { WorkspacePermission } from './entities/permission';
import { DocGrantedUsersService } from './services/doc-granted-users';
import { MemberSearchService } from './services/member-search';
import { WorkspaceMembersService } from './services/members';
import { WorkspacePermissionService } from './services/permission';
import { DocGrantedUsersStore } from './stores/doc-granted-users';
import { MemberSearchStore } from './stores/member-search';
import { WorkspaceMembersStore } from './stores/members';
import { WorkspacePermissionStore } from './stores/permission';

export function configurePermissionsModule(framework: Framework) {
  framework
    .scope(WorkspaceScope)
    .service(WorkspacePermissionService, [
      WorkspaceService,
      WorkspacesService,
      WorkspacePermissionStore,
    ])
    .store(WorkspacePermissionStore, [WorkspaceServerService])
    .entity(WorkspacePermission, [WorkspaceService, WorkspacePermissionStore])
    .service(WorkspaceMembersService, [WorkspaceMembersStore, WorkspaceService])
    .store(WorkspaceMembersStore, [WorkspaceServerService])
    .entity(WorkspaceMembers, [WorkspaceMembersStore, WorkspaceService])
    .service(MemberSearchService, [MemberSearchStore, WorkspaceService])
    .store(MemberSearchStore, [WorkspaceServerService]);

  framework
    .scope(WorkspaceScope)
    .scope(DocScope)
    .service(DocGrantedUsersService, [
      DocGrantedUsersStore,
      WorkspaceService,
      DocService,
    ])
    .store(DocGrantedUsersStore, [WorkspaceServerService]);
}
