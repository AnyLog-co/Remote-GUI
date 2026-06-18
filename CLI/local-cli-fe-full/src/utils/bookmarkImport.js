import { validateNodeConnection } from './connectionAddress';

export const getBookmarkNodeValue = (bookmark) => {
  if (typeof bookmark === 'string') {
    return bookmark.trim();
  }

  if (!bookmark || typeof bookmark !== 'object') {
    return '';
  }

  if (typeof bookmark.node === 'string') {
    return bookmark.node.trim();
  }

  if (
    bookmark.node &&
    typeof bookmark.node === 'object' &&
    typeof bookmark.node.conn === 'string'
  ) {
    return bookmark.node.conn.trim();
  }

  if (typeof bookmark.conn === 'string') {
    return bookmark.conn.trim();
  }

  return '';
};

export const getBookmarkDescription = (bookmark) => {
  if (!bookmark || typeof bookmark !== 'object') {
    return '';
  }

  return typeof bookmark.description === 'string' ? bookmark.description.trim() : '';
};

export const parseBookmarkJson = (jsonText) => {
  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    throw new Error(`Invalid JSON: ${err.message}`);
  }

  const rawBookmarks = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.bookmarks)
      ? parsed.bookmarks
      : null;

  if (!rawBookmarks) {
    throw new Error('Expected a JSON array or an object with a "bookmarks" array.');
  }

  if (rawBookmarks.length === 0) {
    throw new Error('The bookmarks list is empty.');
  }

  const seen = new Set();
  const bookmarks = [];
  let duplicateCount = 0;

  rawBookmarks.forEach((bookmark, index) => {
    const rawNode = getBookmarkNodeValue(bookmark);
    if (!rawNode) {
      throw new Error(`Bookmark ${index + 1} is missing a node value.`);
    }

    const check = validateNodeConnection(rawNode);
    if (!check.ok) {
      throw new Error(`Bookmark ${index + 1} has an invalid node: ${check.message}`);
    }

    if (seen.has(check.value)) {
      duplicateCount++;
      return;
    }

    seen.add(check.value);
    bookmarks.push({
      node: check.value,
      description: getBookmarkDescription(bookmark),
    });
  });

  return {
    bookmarks,
    duplicateCount,
  };
};

export const buildBookmarksExport = (bookmarks) => ({
  bookmarks: bookmarks.map((bookmark) => ({
    node: bookmark.node,
    description: bookmark.description || '',
    created_at: bookmark.created_at || new Date().toISOString(),
    is_default: !!bookmark.is_default,
  })),
});
