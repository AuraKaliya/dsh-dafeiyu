import {biliOwnerScene,biliOwnerConsumerKey} from '@dafeiyu/bilibili/channel';
// Fictional test identities; never used as product defaults.
export const BILI_OWNER_ACCOUNT='10000001';
export const BILI_OWNER_UID='10000002';
export const biliOwnerIdentity={accountUid:BILI_OWNER_ACCOUNT,ownerUid:BILI_OWNER_UID};
export const BILI_OWNER_SCENE=biliOwnerScene(biliOwnerIdentity);
export const BILI_OWNER_CONSUMER_KEY=biliOwnerConsumerKey(biliOwnerIdentity);
