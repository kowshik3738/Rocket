import {
  ChatMessage,
  createOrGetConversation,
  ForwardableMessagePayload,
  getConversation,
  sendMessage,
} from '@/services/messaging-service';
import { getGroups, Group, GroupMessage, sendGroupMessage } from '@/services/group-service';
import { getFriends } from '@/services/social-service';
import { getProfileColor, getProfileInitials, getUserProfile } from '@/services/user-service';

export type { ForwardableMessagePayload };

export type ForwardDestination =
  | {
      id: string;
      type: 'direct';
      targetUid: string;
      title: string;
      subtitle: string;
      initials: string;
      color: string;
      photoUrl?: string;
    }
  | {
      id: string;
      type: 'group';
      groupId: string;
      group: Group;
      title: string;
      subtitle: string;
      initials: string;
      color: string;
      photoUrl?: string;
    };

export interface ForwardResult {
  total: number;
  successCount: number;
  failCount: number;
  errors: string[];
}

export const MAX_FORWARD_DESTINATIONS = 10;

/**
 * Loads all eligible forwarding destinations for current user:
 * 1. Message Yourself (self-chat)
 * 2. Accepted friends (direct 1:1 chats)
 * 3. Groups the user is currently an active member of
 */
export async function getForwardDestinations(currentUid: string): Promise<ForwardDestination[]> {
  const [currentUserProfile, friends, groups] = await Promise.all([
    getUserProfile(currentUid),
    getFriends(currentUid),
    getGroups(currentUid),
  ]);

  const destinations: ForwardDestination[] = [];

  // 1. Message Yourself
  const myName = currentUserProfile?.displayName || 'User';
  destinations.push({
    id: `self_${currentUid}`,
    type: 'direct',
    targetUid: currentUid,
    title: `${myName} (You)`,
    subtitle: 'Message yourself',
    initials: getProfileInitials(myName),
    color: getProfileColor(currentUid),
    photoUrl: currentUserProfile?.photoUrl,
  });

  // 2. Accepted Friends (direct 1:1 chats)
  for (const friend of friends) {
    destinations.push({
      id: `friend_${friend.uid}`,
      type: 'direct',
      targetUid: friend.uid,
      title: friend.displayName,
      subtitle: `@${friend.username}`,
      initials: getProfileInitials(friend.displayName),
      color: getProfileColor(friend.uid),
      photoUrl: friend.photoUrl,
    });
  }

  // 3. Groups the user is in
  for (const group of groups) {
    destinations.push({
      id: `group_${group.id}`,
      type: 'group',
      groupId: group.id,
      group,
      title: group.name,
      subtitle: `${group.memberIds.length} members`,
      initials: getProfileInitials(group.name),
      color: '#00F0FF',
    });
  }

  return destinations;
}

/**
 * Forwards an eligible message payload to 1..10 selected destinations.
 * Creates brand-new independent message records with forwarded: true.
 * Does not re-upload media. Never carries over source metadata.
 */
export async function forwardMessageToDestinations(
  currentUid: string,
  payload: ForwardableMessagePayload,
  destinations: ForwardDestination[]
): Promise<ForwardResult> {
  if (destinations.length === 0) {
    throw new Error('Please select at least one chat to forward to.');
  }
  if (destinations.length > MAX_FORWARD_DESTINATIONS) {
    throw new Error(`You can forward to at most ${MAX_FORWARD_DESTINATIONS} chats at a time.`);
  }

  const errors: string[] = [];
  let successCount = 0;

  const results = await Promise.allSettled(
    destinations.map(async (dest) => {
      if (dest.type === 'direct') {
        const conversationId = await createOrGetConversation(currentUid, dest.targetUid);
        const conversation = await getConversation(conversationId, currentUid);
        await sendMessage(
          conversation,
          currentUid,
          payload.text,
          payload.imageUrl,
          payload.videoUrl,
          payload.file,
          false, // viewOnce is never allowed on forward
          null, // reply is never carried over
          true, // forwarded = true
          payload.audioUrl,
          payload.audioDurationMs,
          payload.audioMimeType
        );
      } else if (dest.type === 'group') {
        await sendGroupMessage(
          dest.group,
          currentUid,
          payload.text,
          payload.imageUrl,
          payload.videoUrl,
          payload.file,
          true, // forwarded = true
          payload.audioUrl,
          payload.audioDurationMs,
          payload.audioMimeType
        );
      }
    })
  );

  for (const res of results) {
    if (res.status === 'fulfilled') {
      successCount++;
    } else {
      errors.push(res.reason instanceof Error ? res.reason.message : 'Failed to forward message');
    }
  }

  return {
    total: destinations.length,
    successCount,
    failCount: errors.length,
    errors,
  };
}
