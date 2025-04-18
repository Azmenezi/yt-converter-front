import { useState, useEffect } from "react";

function App() {
  const [channelUrl, setChannelUrl] = useState("");
  const [videos, setVideos] = useState([]);
  const [downloads, setDownloads] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // For showing a spinner on a per-video basis
  const [downloadingVideos, setDownloadingVideos] = useState({});
  // The IDs of videos currently in queue or in progress
  const [videosInQueue, setVideosInQueue] = useState([]);

  // Count how many downloads completed
  const [downloadCount, setDownloadCount] = useState(0);

  // RANGE MODAL
  const [showRangeModal, setShowRangeModal] = useState(false);
  const [selectedVideo, setSelectedVideo] = useState(null);
  const [rangeStart, setRangeStart] = useState(0);
  const [rangeEnd, setRangeEnd] = useState(0);
  const [duration, setDuration] = useState(300);

  // MODALS for "Downloaded File"
  const [downloadedFile, setDownloadedFile] = useState(null);
  const [batchDownloadedFile, setBatchDownloadedFile] = useState(null);

  // Tabs
  const [activeTab, setActiveTab] = useState("videos");

  // External Audio Processing
  const [externalUrl, setExternalUrl] = useState("");
  const [externalFilename, setExternalFilename] = useState("");
  const [processingExternal, setProcessingExternal] = useState(false);

  /********************************************************************
   * 1. THE TASK-BASED QUEUE
   ********************************************************************/
  // Each item in the queue is now an OBJECT describing what to do.
  // e.g. { id, type, video, startTime, endTime, abortController }
  const [downloadQueue, setDownloadQueue] = useState([]);
  const [isDownloading, setIsDownloading] = useState(false);

  // Helper to add tasks to the queue
  const queueTask = (task) => {
    setDownloadQueue((prev) => [...prev, task]);
  };

  // The main effect that processes the first item in the queue if we're idle
  useEffect(() => {
    if (!isDownloading && downloadQueue.length > 0) {
      // we have something to download and we're not currently busy
      setIsDownloading(true);

      const currentTask = downloadQueue[0];
      // Mark that this video's "downloading" = true
      setDownloadingVideos((prev) => ({ ...prev, [currentTask.id]: true }));

      runTask(currentTask)
        .catch((err) => {
          console.error("Queue task failed:", err);
        })
        .finally(() => {
          // Remove the task from the queue
          setDownloadQueue((prev) => prev.slice(1));

          // remove from videosInQueue
          setVideosInQueue((prev) =>
            prev.filter((vid) => vid !== currentTask.id)
          );

          // Mark as not downloading
          setDownloadingVideos((prev) => ({
            ...prev,
            [currentTask.id]: false,
          }));
          setIsDownloading(false);
        });
    }
  }, [downloadQueue, isDownloading]);

  // The function that performs the actual fetch(es)
  // We look at "task.type" to figure out which fetch to do.
  const runTask = async (task) => {
    switch (task.type) {
      case "mp3Range":
        // Download MP3 with start/end time
        return actuallyDownloadMP3(
          task.video,
          task.startTime,
          task.endTime,
          task.abortController
        );

      case "mp3Simple":
        // Download normal MP3 (with music)
        return actuallyDownloadMP3Simple(task.video, task.abortController);

      case "mp3NoMusic":
        // Download no-music version of MP3 (startTime/endTime = null)
        return actuallyDownloadMP3(
          task.video,
          null,
          null,
          task.abortController
        );

      case "batch":
        return actuallyBatchDownloadAllVideos(task.abortController);

      case "external":
        return actuallyProcessExternalAudio(
          task.url,
          task.filename,
          task.abortController
        );

      default:
        throw new Error("Unknown task type: " + task.type);
    }
  };

  // This is how you could remove a queued task by ID (before it starts)
  // For instance, if you have a "Cancel" button on the queued video.
  const cancelTask = (videoId) => {
    setDownloadQueue((prev) => {
      return prev.filter((task) => {
        // If you wanted to allow in-progress cancel, check if it's the first task
        // and call task.abortController.abort(). For example:
        if (task.id === videoId) {
          // If desired, abort mid-fetch:
          task.abortController?.abort();
        }
        return task.id !== videoId;
      });
    });

    // also remove from videosInQueue
    setVideosInQueue((prev) => prev.filter((id) => id !== videoId));
  };

  /********************************************************************
   * 2. FETCHING VIDEO LIST & DOWNLOAD LIST
   ********************************************************************/
  const fetchVideos = async () => {
    if (!channelUrl.trim()) {
      setError("Please enter a YouTube URL");
      return;
    }
    setLoading(true);
    setError("");
    setDownloadCount(0);

    try {
      const response = await fetch("http://localhost:8001/fetch-videos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelUrl }),
      });
      const data = await response.json();
      if (data.error) {
        setError(data.error);
      } else {
        setVideos(data.videos || []);
      }
    } catch (err) {
      setError("Failed to connect to server.");
    } finally {
      setLoading(false);
    }
  };

  const fetchDownloads = async () => {
    try {
      const response = await fetch("http://localhost:8001/list-downloads");
      const data = await response.json();
      setDownloads(data.files || []);
    } catch (err) {
      console.error("Error fetching downloads", err);
    }
  };

  useEffect(() => {
    fetchDownloads();
  }, []);

  const deleteFile = async (relativePath) => {
    try {
      const response = await fetch(
        `http://localhost:8001/delete-file?file=${encodeURIComponent(
          relativePath
        )}`,
        { method: "DELETE" }
      );
      const data = await response.json();
      if (data.error) setError(data.error);
      else fetchDownloads();
    } catch (err) {
      console.error("Error deleting file", err);
    }
  };

  /********************************************************************
   * 3. "WORKER" FUNCTIONS (the actual fetch calls).
   ********************************************************************/
  // A. Download MP3 with optional segment
  const actuallyDownloadMP3 = async (
    video,
    startTime = null,
    endTime = null,
    abortController
  ) => {
    // Mark it in queue/downloading
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

    const response = await fetch("http://localhost:8001/download-mp3", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: abortController?.signal, // enable abort if needed
    });

    const result = await response.json();

    if (!result.skipped) {
      setDownloadCount((prev) => prev + 1);
      setDownloadedFile({ file: result.file, video });
    }
  };

  // B. Download normal MP3 (with music)
  const actuallyDownloadMP3Simple = async (video, abortController) => {
    setDownloadingVideos((prev) => ({ ...prev, [video.id]: true }));

    const payload = {
      videoUrl: video.url,
      originalFilename: video.originalFilename,
      safeFilename: video.safeFilename,
      folderName: video.folderName || "default",
    };

    const response = await fetch("http://localhost:8001/download-mp3-simple", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: abortController?.signal,
    });

    const result = await response.json();
    if (!result.skipped) {
      setDownloadCount((prev) => prev + 1);
      setDownloadedFile({ file: result.file, video });
    }
  };

  // C. Batch download
  const actuallyBatchDownloadAllVideos = async (abortController) => {
    setLoading(true);

    const payload = {
      videos: videos.map((v) => ({
        videoUrl: v.url,
        originalFilename: v.originalFilename,
        safeFilename: v.safeFilename,
        folderName: v.folderName || "default",
      })),
    };

    const response = await fetch("http://localhost:8001/batch-download-mp3", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: abortController?.signal,
    });

    const result = await response.json();
    if (result.error) {
      setError(result.error);
    } else {
      setBatchDownloadedFile({ file: result.file });
    }
    setLoading(false);
  };

  // D. Process external audio
  const actuallyProcessExternalAudio = async (
    url,
    filename,
    abortController
  ) => {
    setProcessingExternal(true);

    const payload = {
      url,
      filename,
    };

    const response = await fetch(
      "http://localhost:8001/process-external-audio",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: abortController?.signal,
      }
    );

    const result = await response.json();
    if (result.error) {
      setError(result.error);
    } else if (!result.skipped) {
      setDownloadCount((prev) => prev + 1);
      setDownloadedFile({
        file: result.file,
        video: { title: filename || "External Audio" },
      });
    }

    setProcessingExternal(false);
    fetchDownloads();
  };

  /********************************************************************
   * 4. ENQUEUE FUNCTIONS
   ********************************************************************/
  // Enqueue "No Music" MP3
  const downloadMP3 = (video, startTime = null, endTime = null) => {
    const abortController = new AbortController();

    // For the UI spinner or "in queue" label
    setVideosInQueue((prev) => [...prev, video.id]);

    // Create the task object
    queueTask({
      id: video.id,
      type: startTime !== null && endTime !== null ? "mp3Range" : "mp3NoMusic",
      video,
      startTime,
      endTime,
      abortController,
    });
  };

  // Enqueue "Simple MP3" (with music)
  const downloadMP3Simple = (video) => {
    const abortController = new AbortController();

    setVideosInQueue((prev) => [...prev, video.id]);
    queueTask({
      id: video.id,
      type: "mp3Simple",
      video,
      abortController,
    });
  };

  // Enqueue a "batch" download
  const batchDownloadAllVideos = () => {
    const abortController = new AbortController();

    // For UI feedback, consider "videosInQueue = all IDs"
    setVideosInQueue(videos.map((v) => v.id));

    queueTask({
      id: "batch-download",
      type: "batch",
      abortController,
    });
  };

  // Enqueue external audio processing
  const processExternalAudio = () => {
    if (!externalUrl.trim()) {
      setError("Please enter an audio URL");
      return;
    }
    setError("");

    const abortController = new AbortController();
    const taskId = `external-${Date.now()}`;

    queueTask({
      id: taskId,
      type: "external",
      url: externalUrl,
      filename: externalFilename,
      abortController,
    });

    setExternalUrl("");
    setExternalFilename("");
  };

  // Download all videos in sequence (No Music) - Enqueue tasks for each
  const downloadAll = () => {
    setDownloadCount(0);
    setError("");

    videos.forEach((video) => {
      const abortController = new AbortController();
      setVideosInQueue((prev) => [...prev, video.id]);

      queueTask({
        id: video.id,
        type: "mp3NoMusic", // or "mp3Range" if you want
        video,
        abortController,
      });
    });
  };

  /********************************************************************
   * 5. RANGE MODAL
   ********************************************************************/
  const openRangeModal = (video) => {
    setSelectedVideo(video);
    setRangeStart(0);
    setRangeEnd(300);
    setShowRangeModal(true);
  };

  const confirmRangeSelection = () => {
    if (selectedVideo) {
      downloadMP3(selectedVideo, Number(rangeStart), Number(rangeEnd));
      setShowRangeModal(false);
      setSelectedVideo(null);
    }
  };

  useEffect(() => {
    if (showRangeModal && selectedVideo) {
      if (!window.YT) {
        const tag = document.createElement("script");
        tag.src = "https://www.youtube.com/iframe_api";
        document.body.appendChild(tag);
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

  const formatTime = (seconds) => {
    const minutes = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${minutes}:${secs.toString().padStart(2, "0")}`;
  };

  /********************************************************************
   * 6. MODALS
   ********************************************************************/
  const handleDownloadOnly = () => {
    if (!downloadedFile) return;
    window.location.href = `http://localhost:8001/download-file?file=${encodeURIComponent(
      downloadedFile.file
    )}`;
    setDownloadedFile(null);
  };

  const handleDownloadAndDelete = () => {
    if (!downloadedFile) return;
    window.location.href = `http://localhost:8001/download-file?file=${encodeURIComponent(
      downloadedFile.file
    )}`;
    setTimeout(() => {
      deleteFile(downloadedFile.file);
    }, 10000);
    setDownloadedFile(null);
  };

  const handleDeleteOnly = () => {
    if (!downloadedFile) return;
    deleteFile(downloadedFile.file);
    setDownloadedFile(null);
  };

  const handleDeleteAll = async () => {
    try {
      if (downloads.length === 0) {
        setError("No files to delete");
        return;
      }
      const confirmDelete = window.confirm(
        "Are you sure you want to delete all files?"
      );
      if (!confirmDelete) return;

      for (const file of downloads) {
        await deleteFile(file);
      }
    } catch (err) {
      setError("Failed to delete all files");
    }
  };

  /********************************************************************
   * 7. JSX RENDER
   ********************************************************************/
  return (
    <div className="w-screen flex items-center justify-center">
      <div className="w-screen max-w-7xl mx-auto p-6 bg-gray-50 min-h-screen">
        <header className="text-center mb-10">
          <h1 className="text-4xl font-bold text-blue-600 mb-3">
            YouTube MP3 Downloader
          </h1>
          <p className="text-gray-600 text-lg">
            All downloads are queued so only one fetch is sent at a time!
          </p>
        </header>

        {/* Input */}
        <div className="mb-8">
          <div className="flex flex-col sm:flex-row gap-4">
            <input
              type="text"
              placeholder="Enter YouTube URL"
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
              <p>{error}</p>
            </div>
          )}
        </div>

        {/* External Audio Processing Section */}
        <div className="mb-8 bg-white shadow-lg rounded-xl p-6 transition-all">
          <h2 className="text-2xl font-semibold text-gray-800 mb-4">
            Process External Audio
          </h2>
          <p className="text-gray-600 mb-4">
            Enter any audio/video URL to process through the vocal extraction
            pipeline
          </p>

          <div className="flex flex-col gap-4">
            <input
              type="text"
              placeholder="Enter audio/video URL (any website, not just YouTube)"
              value={externalUrl}
              onChange={(e) => setExternalUrl(e.target.value)}
              className="w-full text-black p-4 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />

            <input
              type="text"
              placeholder="Custom filename (optional)"
              value={externalFilename}
              onChange={(e) => setExternalFilename(e.target.value)}
              className="w-full text-black p-4 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />

            <button
              onClick={processExternalAudio}
              disabled={processingExternal || !externalUrl.trim()}
              className="bg-purple-600 text-white px-6 py-4 rounded-lg hover:bg-purple-700 transition-all disabled:opacity-70 disabled:cursor-not-allowed font-medium"
            >
              {processingExternal ? (
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
                  Processing...
                </span>
              ) : (
                "Extract Vocals from URL"
              )}
            </button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex justify-between border-b mb-6 items-center">
          <div className="flex space-x-6">
            <button
              onClick={() => setActiveTab("videos")}
              className={`pb-2 ${
                activeTab === "videos"
                  ? "border-b-2 border-blue-500 font-semibold text-blue-500"
                  : "text-gray-600 hover:text-blue-500"
              }`}
            >
              Videos
            </button>
            <button
              onClick={() => setActiveTab("downloads")}
              className={`pb-2 ${
                activeTab === "downloads"
                  ? "border-b-2 border-blue-500 font-semibold text-blue-500"
                  : "text-gray-600 hover:text-blue-500"
              }`}
            >
              Downloads
            </button>
          </div>

          {/* Show how many items are pending in the queue */}
          <div className="text-sm flex items-center gap-2">
            <span>Queue Size:</span>
            <span className="bg-gray-200 px-3 py-1 rounded-full">
              {downloadQueue.length}
            </span>
          </div>
        </div>

        {/* VIDEOS TAB */}
        {activeTab === "videos" && (
          <>
            {videos.length > 0 && (
              <div className="bg-white shadow-lg rounded-xl p-6 transition-all mb-10">
                <div className="flex flex-wrap justify-between items-center mb-6 gap-4">
                  <h2 className="text-2xl font-semibold text-gray-800">
                    Found {videos.length} video{videos.length > 1 ? "s" : ""}
                  </h2>
                  <div className="flex items-center gap-4">
                    {/* "Download All" (No Music) */}

                    <button
                      onClick={downloadAll}
                      className="bg-blue-600 text-white px-6 py-3 rounded-xl hover:bg-blue-700 transition-all transform hover:-translate-y-1 hover:shadow-md font-medium"
                    >
                      Enqueue "Download All" (No Music)
                    </button>

                    <button
                      onClick={batchDownloadAllVideos}
                      className="bg-green-400 text-white px-6 py-3 rounded-xl hover:bg-green-700 transition-all transform hover:-translate-y-1 hover:shadow-md font-medium flex items-center gap-2"
                    >
                      Batch Download MP3s
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
                      {/* Thumbnail */}
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
                          View on YouTube
                        </a>

                        <div className="mt-5 flex flex-wrap gap-2">
                          {/* No Music */}
                          <button
                            onClick={() => downloadMP3(video)}
                            disabled={
                              downloadingVideos[video.id] ||
                              videosInQueue.includes(video.id)
                            }
                            className="flex-1 bg-gray-200 hover:bg-gray-300 disabled:bg-gray-400 text-gray-800 py-2 px-3 rounded-lg transition-all flex items-center justify-center gap-1 font-medium text-sm"
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
                                Loading...
                              </>
                            ) : videosInQueue.includes(video.id) ? (
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
                                In Queue..
                              </>
                            ) : (
                              "MP3 No Music"
                            )}
                          </button>

                          {/* Simple MP3 */}
                          <button
                            onClick={() => downloadMP3Simple(video)}
                            disabled={
                              downloadingVideos[video.id] ||
                              videosInQueue.includes(video.id)
                            }
                            className="flex-1 bg-green-400 hover:bg-green-500 disabled:bg-green-600 text-white py-2 px-3 rounded-lg transition-all flex items-center justify-center gap-1 font-medium text-sm"
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
                                Loading...
                              </>
                            ) : videosInQueue.includes(video.id) ? (
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
                                In Queue..
                              </>
                            ) : (
                              "MP3"
                            )}
                          </button>
                        </div>

                        <div className="mt-4 flex gap-2">
                          {/* Range */}
                          <button
                            onClick={() => openRangeModal(video)}
                            disabled={
                              downloadingVideos[video.id] ||
                              videosInQueue.includes(video.id)
                            }
                            className="flex-1 bg-indigo-500 disabled:bg-indigo-700 text-white py-2 px-4 rounded-lg hover:bg-indigo-600 transition-all flex items-center justify-center gap-2 font-medium"
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
                                Loading...
                              </>
                            ) : videosInQueue.includes(video.id) ? (
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
                                In Queue..
                              </>
                            ) : (
                              "Select Range"
                            )}
                          </button>

                          {/* Cancel if in queue and NOT currently downloading */}
                          {videosInQueue.includes(video.id) &&
                            !downloadingVideos[video.id] && (
                              <button
                                onClick={() => cancelTask(video.id)}
                                className="bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 transition-all flex items-center justify-center gap-1 font-medium"
                              >
                                Cancel
                              </button>
                            )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

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
          </>
        )}

        {/* DOWNLOADS TAB */}
        {activeTab === "downloads" && (
          <div className="bg-white shadow-lg rounded-xl p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-semibold text-gray-800">
                Downloaded Audios
              </h2>
              <div className="flex gap-3">
                <button
                  onClick={fetchDownloads}
                  className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 transition"
                >
                  Refresh
                </button>
                <button
                  onClick={handleDeleteAll}
                  className="bg-orange-600 text-white px-4 py-2 rounded hover:bg-orange-700 transition"
                >
                  Delete All
                </button>
              </div>
            </div>
            {downloads.length === 0 ? (
              <p className="text-gray-600">No downloaded audios found.</p>
            ) : (
              <ul className="divide-y divide-gray-200">
                {downloads.map((file, idx) => (
                  <li
                    key={idx}
                    className="py-3 flex justify-between items-center"
                  >
                    <span className="text-gray-800">{file}</span>
                    <div className="flex gap-3">
                      <button
                        onClick={() => {
                          window.location.href = `http://localhost:8001/download-file?file=${encodeURIComponent(
                            file
                          )}`;
                          setTimeout(() => {
                            deleteFile(file);
                          }, 10000);
                        }}
                        className="bg-purple-400 text-white px-3 py-1 rounded hover:bg-purple-700 transition"
                      >
                        Download &amp; Delete
                      </button>
                      <button
                        onClick={() => {
                          window.location.href = `http://localhost:8001/download-file?file=${encodeURIComponent(
                            file
                          )}`;
                        }}
                        className="bg-green-400 text-white px-3 py-1 rounded hover:bg-green-700 transition"
                      >
                        Download Only
                      </button>
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
        )}

        {/* RANGE MODAL */}
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
                        const val = Number(e.target.value);
                        if (val < rangeEnd) setRangeStart(val);
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
                        const val = Number(e.target.value);
                        if (val > rangeStart) setRangeEnd(val);
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
                  className="px-6 py-2.5 rounded-xl bg-gray-500 hover:bg-gray-500 text-white transition-all font-medium"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmRangeSelection}
                  className="px-6 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white transition-all shadow-sm font-medium"
                >
                  Download Segment
                </button>
              </div>
            </div>
          </div>
        )}

        {/* SINGLE FILE DOWNLOADED MODAL */}
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
                  Download &amp; Delete
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

        {/* BATCH DOWNLOADED MODAL */}
        {batchDownloadedFile && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6 animate-fadeIn">
              <div className="flex justify-end gap-4">
                <button
                  onClick={() => setBatchDownloadedFile(null)}
                  className="px-6 py-2.5 rounded-full bg-gray-100 hover:bg-gray-200 text-white transition-all font-medium"
                >
                  x
                </button>
              </div>
              <h2 className="text-2xl font-semibold mb-4 text-gray-800">
                Batch Download Complete!
              </h2>
              <p className="text-gray-700 mb-6">
                File:{" "}
                <span className="font-mono">{batchDownloadedFile.file}</span>
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    window.location.href = `http://localhost:8001/download-file?file=${encodeURIComponent(
                      batchDownloadedFile.file
                    )}`;
                    setTimeout(() => {
                      deleteFile(batchDownloadedFile.file);
                    }, 10000);
                    setBatchDownloadedFile(null);
                  }}
                  className="bg-green-400 text-white px-4 py-2 rounded hover:bg-green-700 transition"
                >
                  Download &amp; Delete
                </button>
                <button
                  onClick={() => {
                    window.location.href = `http://localhost:8001/download-file?file=${encodeURIComponent(
                      batchDownloadedFile.file
                    )}`;
                    setBatchDownloadedFile(null);
                  }}
                  className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 transition"
                >
                  Download Only
                </button>
                <button
                  onClick={() => {
                    deleteFile(batchDownloadedFile.file);
                    setBatchDownloadedFile(null);
                  }}
                  className="bg-red-600 text-white px-4 py-2 rounded hover:bg-red-700 transition"
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
