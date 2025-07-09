export default class VideoLayoutManager {
  constructor({ localContainerId = 'localVideos', remoteContainerId = 'remoteVideos' } = {}) {
    this.localContainer = document.getElementById(localContainerId);
    this.remoteContainer = document.getElementById(remoteContainerId);
  }

  createVideoElement({ id, stream, isLocal = false }) {
    const video = document.createElement('video');
    video.id = id;
    video.autoplay = true;
    video.playsInline = true;
    video.controls = isLocal;
    video.muted = isLocal;
    video.srcObject = stream;

    const container = isLocal ? this.localContainer : this.remoteContainer;
    if (container) container.appendChild(video);
  }

  removeVideoElement(id) {
    const video = document.getElementById(id);
    if (video && video.parentElement) {
      video.pause();
      video.srcObject = null;
      video.parentElement.removeChild(video);
    }
  }

  clearAllRemoteVideos() {
    if (!this.remoteContainer) return;
    this.remoteContainer.innerHTML = '';
  }

  getAllRemoteVideos() {
    return this.remoteContainer
      ? Array.from(this.remoteContainer.getElementsByTagName('video'))
      : [];
  }

  setPlaybackStateForAll(remoteOnly = false, playing = true) {
    const videos = remoteOnly
      ? this.getAllRemoteVideos()
      : [...(this.localContainer?.getElementsByTagName('video') || []), ...this.getAllRemoteVideos()];

    videos.forEach((video) => {
      if (playing) {
        video.play().catch((err) => console.warn(`[Video] play() failed: ${err}`));
      } else {
        video.pause();
      }
    });
  }
}