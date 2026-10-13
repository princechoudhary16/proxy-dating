import { config } from '../config.js';
import { runActor } from './apify.js';
import { truncate, retry } from '../util.js';
import { userError } from './urls.js';

const MAX_POSTS = 24;

/** Normalised Instagram shape consumed by the analyst agent. */
function normalize(raw, via) {
  const posts = (raw.latestPosts || raw.posts || []).slice(0, MAX_POSTS).map((p) => ({
    type: p.type || p.productType || null,
    caption: truncate(p.caption || '', 600),
    hashtags: p.hashtags || [],
    mentions: p.mentions || [],
    location: p.locationName || null,
    timestamp: p.timestamp || null,
    likes: p.likesCount ?? null,
    comments: p.commentsCount ?? null,
    image: p.displayUrl || null,
    url: p.url || (p.shortCode ? `https://www.instagram.com/p/${p.shortCode}/` : null),
  }));
  return {
    via,
    username: raw.username,
    fullName: raw.fullName || '',
    biography: raw.biography || '',
    externalUrl: raw.externalUrl || null,
    category: raw.businessCategoryName || null,
    followers: raw.followersCount ?? null,
    following: raw.followsCount ?? null,
    postsCount: raw.postsCount ?? null,
    verified: !!raw.verified,
    isPrivate: !!raw.private,
    profilePic: raw.profilePicUrlHD || raw.profilePicUrl || null,
    posts,
  };
}

async function viaApify(handle) {
  const items = await runActor(config.apify.instagramActor, { usernames: [handle] });
  const item = items.find((i) => i.username?.toLowerCase() === handle) || items[0];
  if (!item || item.error) throw new Error(item?.errorDescription || item?.error || 'Instagram profile not found');
  return normalize(item, 'apify');
}

/** Fallback: Instagram's public web profile endpoint (works from many residential IPs, often blocked from clouds). */
async function viaPublicEndpoint(handle) {
  const res = await fetch(`https://i.instagram.com/api/v1/users/web_profile_info/?username=${handle}`, {
    headers: {
      'x-ig-app-id': '936619743392459',
      'user-agent':
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      accept: 'application/json',
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Instagram public endpoint HTTP ${res.status}`);
  const u = (await res.json())?.data?.user;
  if (!u) throw new Error('Instagram profile not found');
  return normalize(
    {
      username: u.username,
      fullName: u.full_name,
      biography: u.biography,
      externalUrl: u.external_url,
      businessCategoryName: u.category_name,
      followersCount: u.edge_followed_by?.count,
      followsCount: u.edge_follow?.count,
      postsCount: u.edge_owner_to_timeline_media?.count,
      verified: u.is_verified,
      private: u.is_private,
      profilePicUrlHD: u.profile_pic_url_hd,
      latestPosts: (u.edge_owner_to_timeline_media?.edges || []).map(({ node: n }) => ({
        type: n.__typename,
        caption: n.edge_media_to_caption?.edges?.[0]?.node?.text,
        hashtags: (n.edge_media_to_caption?.edges?.[0]?.node?.text?.match(/#[\p{L}\p{N}_]+/gu) || []).map((h) => h.slice(1)),
        locationName: n.location?.name,
        timestamp: n.taken_at_timestamp ? new Date(n.taken_at_timestamp * 1000).toISOString() : null,
        likesCount: n.edge_liked_by?.count ?? n.edge_media_preview_like?.count,
        commentsCount: n.edge_media_to_comment?.count,
        displayUrl: n.display_url,
        shortCode: n.shortcode,
      })),
    },
    'instagram-public'
  );
}

export async function scrapeInstagram(handle) {
  const errors = [];
  for (const [name, fn] of [
    ['apify', viaApify],
    ['public', viaPublicEndpoint],
  ]) {
    if (name === 'apify' && !config.apifyToken) continue;
    try {
      const data = await retry(() => fn(handle), { tries: 2 });
      if (data.isPrivate) throw userError(`@${handle} is a private Instagram account. Only public profiles are supported.`);
      return data;
    } catch (e) {
      if (e.userFacing) throw e;
      errors.push(`${name}: ${e.message}`);
    }
  }
  throw new Error(`Could not read Instagram @${handle} (${errors.join(' | ')})`);
}
