export default function CsvFormatHint() {
  return (
    <div className="mt-2 p-2 bg-yellow-50 border border-yellow-200 rounded text-xs">
      <strong>Format CSV:</strong> content,time,mediaUrls<br />
      <strong>MediaUrls:</strong> Nhiều URL cách nhau bởi dấu ;<br />
      <strong>Ví dụ:</strong>{" "}
      "Nội dung bài viết,09:30,https://example.com/image1.jpg;https://example.com/video.mp4"
    </div>
  );
}
