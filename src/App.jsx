import { useState, useEffect } from "react";

function App() {
  const [channelUrl, setChannelUrl] = useState("");
  const [videos, setVideos] = useState([]);
  const [downloads, setDownloads] = useState([]);
  const [loading, setLoading] = useState(false);
  const [downloadingVideos, setDownloadingVideos] = useState({});
  const [downloadCount, setDownloadCount] = useState(0);
  const [error, setError] = useState("");
  // Modal state for segment (range) selection:
  const [selectedVideo, setSelectedVideo] = useState(null);
  const [rangeStart, setRangeStart] = useState(0);
  const [rangeEnd, setRangeEnd] = useState(0);
  const [duration, setDuration] = useState(300); // default; will update with actual duration
  const [showRangeModal, setShowRangeModal] = useState(false);
  // Modal state for downloaded file actions:
  const [downloadedFile, setDownloadedFile] = useState(null); // { file, video }

  // Helper function: Format seconds as MM:SS.
  const formatTime = (seconds) => {
    const minutes = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${minutes}:${secs.toString().padStart(2, "0")}`;
  };

  // Naively determine if the URL is a single video.
  const isSingleVideo = channelUrl.includes("watch?v=");

  // When the range modal opens, load YouTube IFrame API to get video duration.
  useEffect(() => {
    if (showRangeModal && selectedVideo) {
      if (!window.YT) {
        const tag = document.createElement("script");
        tag.src = "https://www.youtube.com/iframe_api";
        const firstScriptTag = document.getElementsByTagName("script")[0];
        firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
      }
      window.onYouTubeIframeAPIReady = () => {
        new window.YT.Player("yt-player", {
          videoId: selectedVideo.id,
          events: {
            onReady: (event) => {
              const dur = event.target.getDuration();
              setDuration(Math.floor(dur));
              setRangeEnd(Math.floor(dur));
            },
          },
        });
      };
      if (window.YT && window.YT.Player) {
        new window.YT.Player("yt-player", {
          videoId: selectedVideo.id,
          events: {
            onReady: (event) => {
              const dur = event.target.getDuration();
              setDuration(Math.floor(dur));
              setRangeEnd(Math.floor(dur));
            },
          },
        });
      }
    }
  }, [showRangeModal, selectedVideo]);

  // Fetch videos from backend.
  const fetchVideos = async () => {
    if (!channelUrl.trim()) {
      setError("Please enter a YouTube URL");
      return;
    }
    setLoading(true);
    setError("");
    setDownloadCount(0);
    try {
      if (isSingleVideo) {
        const urlObj = new URL(channelUrl);
        const videoId = urlObj.searchParams.get("v");
        const video = {
          id: videoId,
          title: "Single Video",
          url: channelUrl,
          originalFilename: `Single Video_${videoId}.mp3`,
          safeFilename: `SingleVideo_${videoId}.mp3`,
          folderName: "SingleVideo",
        };
        setVideos([video]);
      } else {
        const response = await fetch("http://192.168.8.186:5000/fetch-videos", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ channelUrl }),
        });
        const data = await response.json();
        if (data.error) setError(data.error);
        else setVideos(data.videos || []);
      }
    } catch (err) {
      setError("Failed to connect to the server. Please try again later.");
    } finally {
      setLoading(false);
    }
  };

  // Download MP3 with optional segment parameters.
  const downloadMP3 = async (video, startTime = null, endTime = null) => {
    try {
      setDownloadingVideos((prev) => ({ ...prev, [video.id]: true }));
      const payload = {
        videoUrl: video.url,
        originalFilename: video.originalFilename,
        safeFilename: video.safeFilename,
        folderName: video.folderName || "default",
      };
      if (startTime !== null && endTime !== null) {
        payload.startTime = startTime;
        payload.endTime = endTime;
      }
      const response = await fetch("http://192.168.8.186:5000/download-mp3", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!result.skipped) {
        setDownloadCount((prev) => prev + 1);
        // Show the Downloaded File Modal with info.
        setDownloadedFile({ file: result.file, video });
      }
    } catch (err) {
      setError(`Failed to download "${video.title}"`);
    } finally {
      setDownloadingVideos((prev) => ({ ...prev, [video.id]: false }));
    }
  };

  // Open the segment selection modal.
  const openRangeModal = (video) => {
    setSelectedVideo(video);
    setRangeStart(0);
    setRangeEnd(300);
    setShowRangeModal(true);
  };
  const confirmRangeSelection = () => {
    if (selectedVideo) {
      // Force them to numbers here:
      downloadMP3(selectedVideo, Number(rangeStart), Number(rangeEnd));
      setShowRangeModal(false);
      setSelectedVideo(null);
    }
  };

  const downloadAll = async () => {
    setDownloadCount(0);
    setError("");
    for (const video of videos) {
      await downloadMP3(video);
    }
  };

  // Fetch downloaded files from backend.
  const fetchDownloads = async () => {
    try {
      const response = await fetch("http://192.168.8.186:5000/list-downloads");
      const data = await response.json();
      setDownloads(data.files || []);
    } catch (err) {
      console.error("Error fetching downloads", err);
    }
  };

  useEffect(() => {
    fetchDownloads();
  }, []);

  // Delete a file.
  const deleteFile = async (relativePath) => {
    try {
      const response = await fetch(
        `http://192.168.8.186:5000/delete-file?file=${encodeURIComponent(
          relativePath
        )}`,
        { method: "DELETE" }
      );
      const data = await response.json();
      if (data.error) setError(data.error);
      else {
        // Refresh downloads list.
        fetchDownloads();
      }
    } catch (err) {
      console.error("Error deleting file", err);
    }
  };

  // Handlers for the Downloaded File Modal buttons:
  const handleDownloadOnly = () => {
    if (downloadedFile) {
      window.location.href = `http://192.168.8.186:5000/download-file?file=${encodeURIComponent(
        downloadedFile.file
      )}`;
      setDownloadedFile(null);
    }
  };

  const handleDownloadAndDelete = () => {
    if (downloadedFile) {
      window.location.href = `http://192.168.8.186:5000/download-file?file=${encodeURIComponent(
        downloadedFile.file
      )}`;
      setTimeout(() => {
        deleteFile(downloadedFile.file);
      }, 10000);
      setDownloadedFile(null);
    }
  };

  const handleDeleteOnly = () => {
    if (downloadedFile) {
      deleteFile(downloadedFile.file);
      setDownloadedFile(null);
    }
  };

  return (
    <div className="w-screen flex items-center justify-center">
      <div className="w-screen max-w-7xl mx-auto p-6 bg-gray-50 min-h-screen">
        {/* Header */}
        <header className="text-center mb-10">
          <h1 className="text-4xl font-bold text-blue-600 mb-3">
            YouTube MP3 Downloader
          </h1>
          <p className="text-gray-600 text-lg">
            Convert YouTube videos to MP3 files in bulk or select a segment.
          </p>
        </header>

        {/* URL Input */}
        <div className="mb-8">
          <div className="flex flex-col sm:flex-row gap-4">
            <input
              type="text"
              placeholder="Enter YouTube Channel, Playlist, or Video URL"
              value={channelUrl}
              onChange={(e) => setChannelUrl(e.target.value)}
              disabled={loading}
              className="flex-1 text-black p-4 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
            />
            <button
              onClick={fetchVideos}
              disabled={loading}
              className="bg-blue-600 text-white px-8 py-4 rounded-lg hover:bg-blue-700 transition-all transform hover:-translate-y-1 hover:shadow-md disabled:opacity-70 disabled:cursor-not-allowed font-medium"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg
                    className="animate-spin h-5 w-5 text-white"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    ></circle>
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    ></path>
                  </svg>
                  Fetching...
                </span>
              ) : (
                "Get Videos"
              )}
            </button>
          </div>
          {error && (
            <div className="mt-4 bg-red-100 text-red-700 p-4 rounded-lg border border-red-200 shadow-sm">
              <p className="flex items-center">
                <svg
                  className="h-5 w-5 mr-2"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fillRule="evenodd"
                    d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
                    clipRule="evenodd"
                  ></path>
                </svg>
                {error}
              </p>
            </div>
          )}
        </div>

        {/* Videos List Section */}
        {videos.length > 0 && (
          <div className="bg-white shadow-lg rounded-xl p-6 transition-all mb-10">
            <div className="flex flex-wrap justify-between items-center mb-6 gap-4">
              <h2 className="text-2xl font-semibold text-gray-800">
                Found {videos.length} video{videos.length > 1 ? "s" : ""}
              </h2>
              <div className="flex items-center gap-4">
                <button
                  onClick={downloadAll}
                  disabled={Object.values(downloadingVideos).some((v) => v)}
                  className="bg-green-400 text-white px-6 py-3 rounded-xl hover:bg-green-700 transition-all transform hover:-translate-y-1 hover:shadow-md disabled:opacity-70 disabled:cursor-not-allowed font-medium flex items-center gap-2"
                >
                  <svg
                    className="h-5 w-5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                    ></path>
                  </svg>
                  Download All MP3s
                </button>
                <div className="flex items-center gap-3 text-gray-700 bg-blue-50 px-4 py-2 rounded-xl border border-blue-100">
                  <div className="bg-blue-600 text-white rounded-full w-10 h-10 flex items-center justify-center font-bold shadow-sm">
                    {downloadCount}
                  </div>
                  <span className="font-medium">downloaded</span>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
              {videos.map((video) => (
                <div
                  key={video.id}
                  className="border rounded-xl overflow-hidden shadow-md hover:shadow-xl transition-all duration-300 bg-white"
                >
                  {video.thumbnail && (
                    <div className="h-48 overflow-hidden">
                      <img
                        src={video.thumbnail}
                        alt={video.title}
                        className="w-full h-full object-cover transition-transform duration-300 hover:scale-105"
                        loading="lazy"
                      />
                    </div>
                  )}
                  <div className="p-5">
                    <h3 className="text-lg font-semibold mb-2 text-gray-800 line-clamp-2">
                      {video.title}
                    </h3>
                    <a
                      href={video.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:text-blue-800 hover:underline text-sm inline-flex items-center gap-1"
                    >
                      <svg
                        className="h-4 w-4"
                        fill="currentColor"
                        viewBox="0 0 20 20"
                      >
                        <path
                          fillRule="evenodd"
                          d="M12.586 4.586a2 2 0 112.828 2.828l-3 3a2 2 0 01-2.828 0 1 1 0 00-1.414 1.414 4 4 0 005.656 0l3-3a4 4 0 00-5.656-5.656l-1.5 1.5a1 1 0 101.414 1.414l1.5-1.5zm-5 5a2 2 0 012.828 0 1 1 0 101.414-1.414 4 4 0 00-5.656 0l-3 3a4 4 0 105.656 5.656l1.5-1.5a1 1 0 10-1.414-1.414l-1.5 1.5a2 2 0 11-2.828-2.828l3-3z"
                          clipRule="evenodd"
                        ></path>
                      </svg>
                      View on YouTube
                    </a>
                    <div className="mt-5 flex gap-3">
                      <button
                        onClick={() => downloadMP3(video)}
                        disabled={downloadingVideos[video.id]}
                        className="flex-1 bg-gray-200 hover:bg-gray-300 text-green-400 py-2.5 px-4 rounded-lg transition-all flex items-center justify-center gap-2 font-medium"
                      >
                        {downloadingVideos[video.id] ? (
                          <>
                            <svg
                              className="animate-spin h-4 w-4"
                              viewBox="0 0 24 24"
                            >
                              <circle
                                className="opacity-25"
                                cx="12"
                                cy="12"
                                r="10"
                                stroke="currentColor"
                                strokeWidth="4"
                              ></circle>
                              <path
                                className="opacity-75"
                                fill="currentColor"
                                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                              ></path>
                            </svg>
                            Downloading...
                          </>
                        ) : (
                          "Download MP3"
                        )}
                      </button>
                      <button
                        onClick={() => openRangeModal(video)}
                        className="flex-1 bg-blue-600 text-white py-2.5 px-4 rounded-lg hover:bg-blue-700 transition-all flex items-center justify-center gap-2 font-medium"
                      >
                        <svg
                          className="h-4 w-4"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth="2"
                            d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
                          ></path>
                        </svg>
                        Select Range
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Downloaded Audios Section */}
        <div className="mt-12 bg-white shadow-lg rounded-xl p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-semibold text-gray-800">
              Downloaded Audios
            </h2>
            <button
              onClick={fetchDownloads}
              className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 transition"
            >
              Refresh
            </button>
          </div>
          {downloads.length === 0 ? (
            <p className="text-gray-600">No downloaded audios found.</p>
          ) : (
            <ul className="divide-y divide-gray-200">
              {downloads.map((file, index) => (
                <li
                  key={index}
                  className="py-3 flex justify-between items-center"
                >
                  <span className="text-gray-800">{file}</span>
                  <div className="flex gap-3">
                    <button
                      onClick={() => {
                        window.location.href = `http://192.168.8.186:5000/download-file?file=${encodeURIComponent(
                          file
                        )}`;
                        setTimeout(() => {
                          deleteFile(file);
                        }, 10000);
                      }}
                      className="bg-green-400 text-white px-3 py-1 rounded hover:bg-green-700 transition"
                      download
                    >
                      Download & Delete
                    </button>
                    <a
                      href={`http://192.168.8.186:5000/download-file?file=${encodeURIComponent(
                        file
                      )}`}
                      className="bg-green-400 text-white px-3 py-1 rounded hover:bg-green-700 transition"
                      download
                    >
                      Download Only
                    </a>
                    <button
                      onClick={() => deleteFile(file)}
                      className="bg-red-600 text-white px-3 py-1 rounded hover:bg-red-700 transition"
                    >
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {loading && (
          <div className="text-center py-12 text-gray-600">
            <div className="animate-spin rounded-full h-16 w-16 border-t-4 border-b-4 border-blue-600 mx-auto mb-6"></div>
            <p className="text-lg">Fetching videos...</p>
          </div>
        )}

        {!loading && videos.length === 0 && !error && (
          <div className="text-center py-16 text-gray-500 bg-white rounded-xl shadow-md">
            <div className="text-7xl mb-6">🎵</div>
            <p className="text-xl">
              Enter a YouTube Channel, Playlist, or Video URL to get started
            </p>
          </div>
        )}

        {/* Hidden div for YouTube IFrame API */}
        <div id="yt-player-container" className="hidden"></div>

        {/* Modal for selecting time range */}
        {showRangeModal && selectedVideo && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg p-6 animate-fadeIn">
              <h2 className="text-2xl font-semibold mb-4 text-gray-800">
                Select Time Range for "{selectedVideo.title}"
              </h2>
              <div className="mb-6">
                <iframe
                  id="yt-player"
                  title="Video Preview"
                  className="w-full h-64 rounded-lg shadow-md"
                  src={`https://www.youtube.com/embed/${selectedVideo.id}?enablejsapi=1&start=${rangeStart}`}
                  frameBorder="0"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                ></iframe>
              </div>
              <div className="mb-6 bg-gray-50 p-4 rounded-lg">
                <div className="flex justify-between text-sm font-medium mb-2 text-black">
                  <span>Start: {formatTime(rangeStart)}</span>
                  <span>End: {formatTime(rangeEnd)}</span>
                  <span>Duration: {formatTime(duration)}</span>
                </div>
                <div className="space-y-6 mt-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Start Time: {formatTime(rangeStart)}
                    </label>
                    <input
                      type="range"
                      min="0"
                      max={duration}
                      value={rangeStart}
                      onChange={(e) => {
                        const newStart = Number(e.target.value);
                        if (newStart < rangeEnd) setRangeStart(newStart);
                      }}
                      className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-green-400"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      End Time: {formatTime(rangeEnd)}
                    </label>
                    <input
                      type="range"
                      min="0"
                      max={duration}
                      value={rangeEnd}
                      onChange={(e) => {
                        const newEnd = Number(e.target.value);
                        if (newEnd > rangeStart) setRangeEnd(newEnd);
                      }}
                      className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-red-600"
                    />
                  </div>
                  <div className="text-sm text-gray-600 text-center">
                    Selected: {formatTime(rangeStart)} to {formatTime(rangeEnd)}{" "}
                    ({formatTime(rangeEnd - rangeStart)} total)
                  </div>
                </div>
              </div>
              <div className="flex justify-end gap-4">
                <button
                  onClick={() => setShowRangeModal(false)}
                  className="px-6 py-2.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-white transition-all font-medium"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmRangeSelection}
                  className="px-6 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-green-400 transition-all shadow-sm font-medium"
                >
                  Download Segment
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Modal for downloaded file actions */}
        {downloadedFile && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6 animate-fadeIn">
              <div className="flex justify-end gap-4">
                <button
                  onClick={() => setDownloadedFile(null)}
                  className="px-6 py-2.5 rounded-full bg-gray-100 hover:bg-gray-200 text-white transition-all font-medium"
                >
                  x
                </button>
              </div>
              <h2 className="text-2xl font-semibold mb-4 text-gray-800">
                Downloaded: {downloadedFile.video.title}
              </h2>
              <p className="text-gray-700 mb-6">
                File: <span className="font-mono">{downloadedFile.file}</span>
              </p>
              <div className="flex justify-between gap-4">
                <button
                  onClick={handleDownloadAndDelete}
                  className="flex-1 bg-indigo-600 text-white px-4 py-2 rounded hover:bg-indigo-700 transition"
                >
                  Download & Delete
                </button>
                <button
                  onClick={handleDownloadOnly}
                  className="flex-1 bg-green-400 text-white px-4 py-2 rounded hover:bg-green-700 transition"
                >
                  Download Only
                </button>
                <button
                  onClick={handleDeleteOnly}
                  className="flex-1 bg-red-600 text-white px-4 py-2 rounded hover:bg-red-700 transition"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
