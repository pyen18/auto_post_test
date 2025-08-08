
/**
 * Định nghĩa các loại message có thể được gửi đi trong extension.
 * Sử dụng Discriminated Union để đảm bảo type-safety.
 */
export type ExtensionMessage =
  | { type: "FETCH_GROUP_POSTS" }
  | { type: "POST_TO_WALL"; posts: string[] };

/**
 * Cấu trúc response cho yêu cầu lấy bài viết.
 */
export interface FetchPostsResponse {
  posts: string[];
}

/**
 * Cấu trúc response cho yêu cầu đăng bài.
 */
export interface PostToWallResponse {
  success: boolean;
  message: string;
}