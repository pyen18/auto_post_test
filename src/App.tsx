import { useEffect, useState } from 'react';

function App() {
  const [posts, setPosts] = useState<string[]>([]);

  useEffect(() => {
    chrome.storage.local.get(['scrapedPosts'], (result) => {
      if (result.scrapedPosts) {
        setPosts(result.scrapedPosts);
      }
    });
  }, []);

  return (
    <div className="p-16 text-sm">
      <h1 className="text-xl font-bold mb-2">Bài viết lấy từ Group:</h1>
      {posts.map((p, i) => (
        <div key={i} className="bg-gray-100 p-2 rounded mb-2">
          {p}
        </div>
      ))}
    </div>
  );
}

export default App;
