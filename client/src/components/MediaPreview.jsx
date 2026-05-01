import { useEffect, useState } from "react";

export default function MediaPreview({ path, token }) {
  const [mediaUrl, setMediaUrl] = useState("");
  const [isVideo, setIsVideo] = useState(true);

  useEffect(() => {
    let isCancelled = false;
    let objectUrl = "";

    if (!path || !token) {
      setMediaUrl("");
      return () => {};
    }

    fetch(path, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    })
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load media.");
        return res.blob();
      })
      .then((blob) => {
        if (isCancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setMediaUrl(objectUrl);
        setIsVideo(String(blob.type || "").startsWith("video/"));
      })
      .catch(() => {
        if (!isCancelled) {
          setMediaUrl("");
          setIsVideo(true);
        }
      });

    return () => {
      isCancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [path, token]);

  if (!path || !mediaUrl) return <span className="muted">No media</span>;

  if (isVideo) {
    return (
      <video className="media-preview" controls muted preload="metadata">
        <source src={mediaUrl} />
      </video>
    );
  }

  return <img className="media-preview" src={mediaUrl} alt="Catch submission" />;
}
