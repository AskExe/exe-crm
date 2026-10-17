// Exact native helper identity. This is not a native receipt or Core authority.
export const PRIVATE_NATIVE_LOCK_OWNER = 'exe_crm_native_lock_owner';
export const PRIVATE_NATIVE_LOCK_SIGNATURE =
  'core.lock_private_native_empty(uuid)';
export const PRIVATE_NATIVE_LOCK_BODY = `
BEGIN
  LOCK TABLE core.workspace, core."user" IN EXCLUSIVE MODE;
  IF NOT EXISTS(SELECT 1 FROM core."privateNativeAction" WHERE "actionId"=aid)
    OR EXISTS(SELECT 1 FROM core.workspace) OR EXISTS(SELECT 1 FROM core."user") THEN
    RAISE EXCEPTION 'Private native database unavailable' USING ERRCODE='23505';
  END IF;
END
`;
