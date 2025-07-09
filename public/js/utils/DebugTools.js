import Logger from './Logger.js';

export default class DebugTools {
  constructor({ videoManager, streamManager }) {
    this.videoManager = videoManager;
    this.streamManager = streamManager;
  }

  expose() {
    window.DEBUG = true;

    window.debugVideoState = () => {
      Logger.info('[Debug] Local/Remote video tags:');
      document.querySelectorAll('video').forEach((v, i) => {
        Logger.info(`Video[${i}] id=${v.id}, srcObject=`, v.srcObject);
      });
    };

    window.playAllVideos = () => {
      Logger.info('[Debug] Forcing all videos to play...');
      this.videoManager?.setPlaybackStateForAll(false, true);
    };

    window.pauseAllVideos = () => {
      Logger.info('[Debug] Pausing all videos...');
      this.videoManager?.setPlaybackStateForAll(false, false);
    };

    window.showPeerMap = () => {
      Logger.info('[Debug] PeerStreams:', this.streamManager?.getPeerStreamMap?.());
    };

    window.forceShowPlayButtons = () => {
      document.querySelectorAll('video').forEach((v) => {
        v.controls = true;
        v.style.border = '2px solid orange';
      });
    };

    Logger.info('[DebugTools] Commands registered on window.*');
  }
}