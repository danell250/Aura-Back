/**
 * Utility functions for hashtag processing
 */

export interface HashtagMatch {
  tag: string;
  startIndex: number;
  endIndex: number;
}

/**
 * Extract hashtags from text content
 * @param text - The text to extract hashtags from
 * @returns Array of hashtag objects with position information
 */
export function extractHashtags(text: string): HashtagMatch[] {
  const hashtagRegex = /#([a-zA-Z0-9_]+)/g;
  const hashtags: HashtagMatch[] = [];
  let match;

  while ((match = hashtagRegex.exec(text)) !== null) {
    hashtags.push({
      tag: match[1].toLowerCase(), // Store in lowercase for consistency
      startIndex: match.index,
      endIndex: match.index + match[0].length
    });
  }

  return hashtags;
}

/**
 * Get unique hashtags from text as a simple array
 * @param text - The text to extract hashtags from
 * @returns Array of unique hashtag strings (without #)
 */
export function getHashtagsFromText(text: string): string[] {
  const hashtags = extractHashtags(text);
  const uniqueTags = new Set(hashtags.map(h => h.tag));
  return Array.from(uniqueTags);
}

/**
 * Format text with clickable hashtags for frontend display
 * @param text - The original text
 * @param onHashtagClick - Optional callback for hashtag clicks
 * @returns Text with hashtags wrapped in spans or links
 */
export function formatHashtagsForDisplay(text: string): string {
  return text.replace(/#([a-zA-Z0-9_]+)/g, '<span class="hashtag">#$1</span>');
}

/**
 * Validate hashtag format
 * @param tag - The hashtag to validate (with or without #)
 * @returns Boolean indicating if hashtag is valid
 */
export function isValidHashtag(tag: string): boolean {
  const cleanTag = tag.startsWith('#') ? tag.slice(1) : tag;
  const hashtagRegex = /^[a-zA-Z0-9_]+$/;
  return hashtagRegex.test(cleanTag) && cleanTag.length >= 1 && cleanTag.length <= 50;
}

/**
 * Clean and normalize hashtag
 * @param tag - The hashtag to clean
 * @returns Cleaned hashtag without # prefix, lowercase
 */
export function normalizeHashtag(tag: string): string {
  const cleanTag = tag.startsWith('#') ? tag.slice(1) : tag;
  return cleanTag.toLowerCase().trim();
}

/**
 * Search for content containing specific hashtags
 * @param content - Array of content items with hashtags field
 * @param searchTags - Array of hashtags to search for
 * @returns Filtered content matching any of the search tags
 */
export function filterByHashtags<T extends { hashtags: string[] }>(
  content: T[],
  searchTags: string[]
): T[] {
  if (!searchTags.length) return content;
  
  const normalizedSearchTags = searchTags.map(normalizeHashtag);
  
  return content.filter(item =>
    item.hashtags.some(tag =>
      normalizedSearchTags.includes(normalizeHashtag(tag))
    )
  );
}

/**
 * Get trending hashtags from content
 * @param content - Array of content items with hashtags
 * @param limit - Maximum number of trending tags to return
 * @returns Array of hashtags sorted by frequency
 */
export function getTrendingHashtags<T extends { hashtags: string[]; timestamp: number }>(
  content: T[],
  limit: number = 10,
  timeWindowHours: number = 24
): { tag: string; count: number }[] {
  const cutoffTime = Date.now() - (timeWindowHours * 60 * 60 * 1000);
  const recentContent = content.filter(item => item.timestamp > cutoffTime);
  
  const tagCounts = new Map<string, number>();
  
  recentContent.forEach(item => {
    item.hashtags.forEach(tag => {
      const normalizedTag = normalizeHashtag(tag);
      tagCounts.set(normalizedTag, (tagCounts.get(normalizedTag) || 0) + 1);
    });
  });
  
  return Array.from(tagCounts.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}