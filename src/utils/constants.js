exports.NODE_ID = process.env.NODE_ID || 'sfu1';
exports.PORT = parseInt(process.env.PORT || '3001', 10);
exports.HOST = process.env.HOST || 'localhost';
exports.COORDINATOR_URL = process.env.COORDINATOR_URL || 'http://localhost:4000';
exports.SIGNALING_SERVER = process.env.SIGNALING_SERVER || 'http://localhost:3000';

// MediaSoup configuration
exports.createMediasoupConfig = () => {
  const portOffset = (exports.PORT - 3000) * 1000;
  return {
    worker: {
      rtcMinPort: Math.max(10000 + portOffset, 10000),
      rtcMaxPort: Math.min(10000 + portOffset + 999, 65535),
      logLevel: process.env.DEBUG ? 'debug' : 'warn',
      logTags: [
        'info',
        'ice',
        'dtls',
        'rtp',
        'srtp',
        'rtcp'
      ]
    },
    router: {
      mediaCodecs: [
        {
          kind: 'audio',
          mimeType: 'audio/opus',
          clockRate: 48000,
          channels: 2
        },
        {
          kind: 'video',
          mimeType: 'video/VP8',
          clockRate: 90000,
          parameters: {
            'x-google-start-bitrate': 1000
          }
        },
        {
          kind: 'video',
          mimeType: 'video/VP9',
          clockRate: 90000,
          parameters: {
            'profile-id': 2,
            'x-google-start-bitrate': 1000
          }
        },
        {
          kind: 'video',
          mimeType: 'video/h264',
          clockRate: 90000,
          parameters: {
            'packetization-mode': 1,
            'profile-level-id': '4d0032',
            'level-asymmetry-allowed': 1,
            'x-google-start-bitrate': 1000
          }
        }
      ]
    },
    webRtcTransport: {
      listenIps: [
        {
          ip: '0.0.0.0',
          announcedIp: process.env.MEDIASOUP_ANNOUNCED_IP || '127.0.0.1'
        }
      ],
      maxIncomingBitrate: 1500000,
      initialAvailableOutgoingBitrate: 1000000,
      minimumAvailableOutgoingBitrate: 600000,
      enableUdp: true,
      enableTcp: true,
      preferUdp: true
    }
  };
};
