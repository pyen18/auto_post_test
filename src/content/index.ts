import {  postContentToFacebook } from "./post";
import { openPostDialog, waitForDialogClose } from "./ui";
import { delay } from "./utils";


let isProcessing = false;

// ======= Message listener - ENHANCED =======

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
if (message.type === "START_POST") {
if (isProcessing) {
console.log("[AutoPoster] Already processing, ignoring duplicate request");
sendResponse({ success: false, message: "Already processing posts" });
return;
}


isProcessing = true;


chrome.storage.local.get("postsToPost", async (result) => {
const posts: { content: string; mediaUrls?: string[] }[] =
result.postsToPost || [];

if (posts.length === 0) {
isProcessing = false;
sendResponse({ success: false, message: "Không có bài viết để đăng" });
return;
}


console.log("[AutoPoster] Starting to process", posts.length, "posts");
console.log("[AutoPoster] Posts details:", posts.map((p, i) => ({
index: i,
contentLength: p.content?.length || 0,
mediaCount: p.mediaUrls?.length || 0
})));


let successCount = 0;
const errors: string[] = [];


for (let i = 0; i < posts.length; i++) {
const post = posts[i];


console.log(`[AutoPoster] Processing post ${i + 1}/${posts.length}`);
console.log(`[AutoPoster] Post content: ${(post.content || "").substring(0, 100)}...`);
console.log(`[AutoPoster] Media URLs: ${post.mediaUrls || []}`);


try {
const dialogOpened = await openPostDialog();


if (!dialogOpened) {
const error = `Could not open post dialog for post ${i + 1}`;
console.error("[AutoPoster]", error);
errors.push(error);
break;
}


// const posted = await postContentToFacebook(
// post.content || "",
// post.mediaUrls || [],
// );

const posted = await postContentToFacebook(
post.content || "",
post.mediaUrls || [],
);




if (!posted) {
const error = `Failed to post content for post ${i + 1}`;
console.error("[AutoPoster]", error);
errors.push(error);
break;
}


successCount++;
console.log(`[AutoPoster] Successfully posted ${successCount}/${posts.length}`);


await waitForDialogClose(); // 👈 đảm bảo dialog đã đóng trước khi post tiếp theo


if (i < posts.length - 1) {
console.log("[AutoPoster] Waiting before next post...");
await delay(10000);
}


} catch (error) {
const errorMsg = `Error posting ${i + 1}: ${error}`;
console.error("[AutoPoster]", errorMsg);
errors.push(errorMsg);
break;
}
}

chrome.storage.local.remove("postsToPost");
isProcessing = false;


const finalMessage = `Đã hoàn thành đăng ${successCount}/${posts.length} bài` +
(errors.length > 0 ? `. Lỗi: ${errors.join(", ")}` : "");


console.log("[AutoPoster] Final result:", finalMessage);


sendResponse({
success: successCount > 0,
message: finalMessage,
successCount,
totalCount: posts.length,
errors: errors
});
});


return true;
}


return false;
});