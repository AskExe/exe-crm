import { type AuthContextUser } from 'src/engine/core-modules/auth/types/auth-context.type';
import { UserResolver } from 'src/engine/core-modules/user/user.resolver';
import { type UserEntity } from 'src/engine/core-modules/user/user.entity';
import { type WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { AuthProviderEnum } from 'src/engine/core-modules/workspace/types/workspace.type';

let editorEnabled = true;
jest.mock('../company-editor.config', () => ({
  companyEditorEnabled: () => editorEnabled,
}));
const workspace = { id: 'workspace-A', displayName: 'A' } as WorkspaceEntity;
const user = {
  id: 'native-user',
  email: 'verified@example.test',
} as AuthContextUser;
const members = [
  { workspaceId: 'workspace-A' },
  { workspaceId: 'workspace-B' },
];
const findOne = jest.fn();
const available = jest.fn();
const mint = jest.fn();
const urls = jest.fn();
const resolver = () =>
  new UserResolver(
    ...([
      { findOne },
      {},
      {},
      {},
      {},
      {},
      {},
      {},
      {},
      {},
      {
        findAvailableWorkspacesByEmail: available,
        setLoginTokenToAvailableWorkspacesWhenAuthProviderMatch: mint,
      },
      {},
      { getWorkspaceUrls: urls },
    ] as unknown as ConstructorParameters<typeof UserResolver>),
  );

beforeEach(() => {
  jest.clearAllMocks();
  editorEnabled = true;
  urls.mockReturnValue({
    subdomainUrl: 'https://crm.a.example',
    customUrl: null,
  });
});
it('keeps the editor on the actual admitted native workspace without calling token creation', async () => {
  const current = resolver();
  expect(
    await current.availableWorkspaces(
      user,
      AuthProviderEnum.Password,
      workspace,
    ),
  ).toEqual({
    availableWorkspacesForSignIn: [
      {
        id: workspace.id,
        displayName: 'A',
        workspaceUrls: urls.mock.results[0].value,
        sso: [],
      },
    ],
    availableWorkspacesForSignUp: [],
  });
  expect(
    await current.workspaces(
      { userWorkspaces: members } as UserEntity,
      workspace,
    ),
  ).toEqual([members[0]]);
  expect(available).not.toHaveBeenCalled();
  expect(mint).not.toHaveBeenCalled();
});
it('refuses an editor bootstrap with no admitted workspace before native identity lookup', async () => {
  const current = resolver();
  await expect(
    current.currentUser(user, undefined as unknown as WorkspaceEntity),
  ).rejects.toThrow('Company authorization denied');
  await expect(
    current.availableWorkspaces(user, AuthProviderEnum.Password, undefined),
  ).rejects.toThrow('Company authorization denied');
  await expect(
    current.workspaces({ userWorkspaces: members } as UserEntity, undefined),
  ).rejects.toThrow('Company authorization denied');
  expect(findOne).not.toHaveBeenCalled();
  expect(mint).not.toHaveBeenCalled();
});
it('preserves the standalone native available-workspace and token service path', async () => {
  editorEnabled = false;
  const ordinary = {
    availableWorkspacesForSignIn: [],
    availableWorkspacesForSignUp: [],
  };
  available.mockResolvedValue(ordinary);
  mint.mockResolvedValue(ordinary);
  const current = resolver();
  expect(
    await current.availableWorkspaces(
      user,
      AuthProviderEnum.Password,
      undefined,
    ),
  ).toBe(ordinary);
  expect(available).toHaveBeenCalledWith(user.email);
  expect(mint).toHaveBeenCalledWith(ordinary, user, AuthProviderEnum.Password);
  expect(
    await current.workspaces(
      { userWorkspaces: members } as UserEntity,
      undefined,
    ),
  ).toBe(members);
});
