//
// Deprecated re-export. The auth form contract (AuthFormState, IDLE, …) lives
// in src/core/auth-forms.ts, because adapters, routes and components all share
// it. Import from "@/core/auth-forms"; this file stays only until the last
// import outside the auth area (src/app/dashboard/settings/actions.ts) moves.
//

export {
  IDLE,
  type AuthFieldName,
  type AuthFormAction,
  type AuthFormState,
  type AuthFormStatus,
  type TwoFactorSetup,
} from "@/core/auth-forms";
