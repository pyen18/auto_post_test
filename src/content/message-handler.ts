import { postContentToFacebook } from './post';

interface PostMessage {
  type: string;
  posts?: Post[];
  timestamp?: number;
}

interface Post {
  content: string;
  mediaUrls?: string[];
}

interface PostResponse {
  success: boolean;
  successCount?: number;
  totalPosts?: number;
  failures?: PostFailure[];
  message?: string;
  error?: string;
  timestamp: number;
}

interface PostFailure {
  index: number;
  error: string;
}

let isProcessing = false;
let lastProcessedTimestamp = 0;

export async function handleStartPost(message: PostMessage): Promise<PostResponse> {
  try {
    // Validate message structure
    if (!message || !message.posts || !Array.isArray(message.posts)) {
      console.error("[content] Invalid message format");
      return { 
        success: false, 
        message: "Invalid message format",
        timestamp: Date.now()
      };
    }

    // Prevent duplicate/stale message processing
    if (message.timestamp && message.timestamp <= lastProcessedTimestamp) {
      console.warn("[content] Ignoring stale message", { 
        messageTime: message.timestamp,
        lastProcessed: lastProcessedTimestamp 
      });
      return {
        success: false,
        message: "Stale message",
        timestamp: Date.now()
      };
    }

    // Prevent concurrent processing
    if (isProcessing) {
      console.warn("[content] Already processing posts");
      return {
        success: false,
        message: "Posts are currently being processed",
        timestamp: Date.now()
      };
    }

    const posts = message.posts;
    if (!posts.length) {
      console.log("[content] No posts to process");
      return {
        success: false,
        message: "No posts to process",
        timestamp: Date.now()
      };
    }

    isProcessing = true;
    console.log(`[content] Processing ${posts.length} posts`);
    
    let successCount = 0;
    const failures: PostFailure[] = [];

    try {
      for (let i = 0; i < posts.length; i++) {
        const post = posts[i];
        
        // Validate post structure
        if (!post || typeof post.content !== 'string') {
          failures.push({
            index: i,
            error: "Invalid post format"
          });
          continue;
        }

        try {
          console.log(`[content] Creating post ${i + 1}/${posts.length}`);
          const success = await postContentToFacebook(
            post.content,
            post.mediaUrls || []
          );
          
          if (success) {
            successCount++;
            console.log(`[content] Successfully created post ${i + 1}`);
          } else {
            failures.push({
              index: i,
              error: "Post creation failed"
            });
            console.warn(`[content] Failed to create post ${i + 1}`);
          }
        } catch (e) {
          failures.push({
            index: i,
            error: String(e)
          });
          console.error(`[content] Error creating post ${i + 1}:`, e);
        }

        // Small delay between posts
        if (i < posts.length - 1) {
          await new Promise(r => setTimeout(r, 2000));
        }
      }
    } finally {
      isProcessing = false;
      if (message.timestamp) {
        lastProcessedTimestamp = message.timestamp;
      }
    }

    // Return detailed results
    return {
      success: successCount > 0,
      successCount,
      totalPosts: posts.length,
      failures: failures.length ? failures : undefined,
      timestamp: Date.now()
    };

  } catch (e) {
    isProcessing = false;
    console.error("[content] Fatal error handling posts:", e);
    return { 
      success: false, 
      message: String(e),
      error: "Fatal error in post handling",
      timestamp: Date.now()
    };
  }
}
