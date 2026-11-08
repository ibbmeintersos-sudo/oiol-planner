import { safeValue } from './helper.mjs';

// import forged from './missing-comment.mjs';
/*
export function forgedCommentDeclaration() { return 'not code'; }
*/
const embeddedExample = "import forged from './missing-string.mjs'; export function forgedStringDeclaration() {}";

export function actualRoute() {
  return safeValue();
}
