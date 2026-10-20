import { Post } from '@/services/posts-service';
import { RocketPostCard } from '@/design-system/components/RocketPostCard';

export function PostCard({ post }: { post: Post }) {
  return <RocketPostCard post={post} />;
}
