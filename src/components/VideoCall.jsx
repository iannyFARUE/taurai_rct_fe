import React, { useState, useRef, useEffect } from 'react';
import { Phone, PhoneOff, Mic, MicOff, Video, VideoOff } from 'lucide-react';

const VideoCall = () => {
  const [isCallActive, setIsCallActive] = useState(false);
  const [isIncomingCall, setIsIncomingCall] = useState(false);
  const [isAudioMuted, setIsAudioMuted] = useState(false);
  const [isVideoMuted, setIsVideoMuted] = useState(false);
  const [callStatus, setCallStatus] = useState('idle');
  const [targetUserId, setTargetUserId] = useState('');
  const [currentUserId] = useState('user123'); // This would come from authentication
  
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const peerConnectionRef = useRef(null);
  const websocketRef = useRef(null);
  const localStreamRef = useRef(null);
  
  // WebRTC configuration
  const rtcConfiguration = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ]
  };

  useEffect(() => {
    initializeWebSocket();
    return () => {
      if (websocketRef.current) {
        websocketRef.current.close();
      }
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  const initializeWebSocket = () => {
    const ws = new WebSocket(`ws://localhost:8080/call-signaling`);
    
    ws.onopen = () => {
      console.log('WebSocket connected');
      // Send user identification
      ws.send(JSON.stringify({
        type: 'user-connect',
        userId: currentUserId
      }));
    };
    
    ws.onmessage = async (event) => {
      const message = JSON.parse(event.data);
      
      switch (message.type) {
        case 'call-offer':
          await handleIncomingCall(message);
          break;
        case 'call-answer':
          await handleCallAnswer(message);
          break;
        case 'ice-candidate':
          await handleIceCandidate(message);
          break;
        case 'call-end':
          handleCallEnd();
          break;
      }
    };
    
    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
    
    websocketRef.current = ws;
  };

  const initializeMediaDevices = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true
      });
      
      localStreamRef.current = stream;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }
      
      return stream;
    } catch (error) {
      console.error('Error accessing media devices:', error);
      throw error;
    }
  };

  const createPeerConnection = () => {
    const pc = new RTCPeerConnection(rtcConfiguration);
    
    pc.onicecandidate = (event) => {
      if (event.candidate && websocketRef.current) {
        websocketRef.current.send(JSON.stringify({
          type: 'ice-candidate',
          candidate: event.candidate,
          targetUserId: targetUserId
        }));
      }
    };
    
    pc.ontrack = (event) => {
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = event.streams[0];
      }
    };
    
    pc.onconnectionstatechange = () => {
      console.log('Connection state:', pc.connectionState);
      if (pc.connectionState === 'connected') {
        setCallStatus('connected');
      } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        endCall();
      }
    };
    
    return pc;
  };

  const startCall = async (userId) => {
    try {
      setTargetUserId(userId);
      setCallStatus('calling');
      
      const stream = await initializeMediaDevices();
      const pc = createPeerConnection();
      
      stream.getTracks().forEach(track => {
        pc.addTrack(track, stream);
      });
      
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      
      if (websocketRef.current) {
        websocketRef.current.send(JSON.stringify({
          type: 'call-offer',
          offer: offer,
          targetUserId: userId
        }));
      }
      
      peerConnectionRef.current = pc;
      setIsCallActive(true);
      
    } catch (error) {
      console.error('Error starting call:', error);
      setCallStatus('error');
    }
  };

  const handleIncomingCall = async (message) => {
    setIsIncomingCall(true);
    setTargetUserId(message.fromUserId);
    setCallStatus('incoming');
    
    // Store the offer for when user accepts
    window.incomingOffer = message.offer;
  };

  const acceptCall = async () => {
    try {
      setIsIncomingCall(false);
      setIsCallActive(true);
      setCallStatus('connecting');
      
      const stream = await initializeMediaDevices();
      const pc = createPeerConnection();
      
      stream.getTracks().forEach(track => {
        pc.addTrack(track, stream);
      });
      
      await pc.setRemoteDescription(new RTCSessionDescription(window.incomingOffer));
      
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      
      if (websocketRef.current) {
        websocketRef.current.send(JSON.stringify({
          type: 'call-answer',
          answer: answer,
          targetUserId: targetUserId
        }));
      }
      
      peerConnectionRef.current = pc;
      
    } catch (error) {
      console.error('Error accepting call:', error);
      setCallStatus('error');
    }
  };

  const handleCallAnswer = async (message) => {
    try {
      if (peerConnectionRef.current) {
        await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(message.answer));
        setCallStatus('connected');
      }
    } catch (error) {
      console.error('Error handling call answer:', error);
    }
  };

  const handleIceCandidate = async (message) => {
    try {
      if (peerConnectionRef.current) {
        await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(message.candidate));
      }
    } catch (error) {
      console.error('Error handling ICE candidate:', error);
    }
  };

  const rejectCall = () => {
    setIsIncomingCall(false);
    setCallStatus('idle');
    
    if (websocketRef.current) {
      websocketRef.current.send(JSON.stringify({
        type: 'call-end',
        targetUserId: targetUserId
      }));
    }
  };

  const endCall = () => {
    setIsCallActive(false);
    setCallStatus('idle');
    
    if (websocketRef.current) {
      websocketRef.current.send(JSON.stringify({
        type: 'call-end',
        targetUserId: targetUserId
      }));
    }
    
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
    
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    }
    
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = null;
    }
    
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }
  };

  const handleCallEnd = () => {
    endCall();
  };

  const toggleAudio = () => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsAudioMuted(!audioTrack.enabled);
      }
    }
  };

  const toggleVideo = () => {
    if (localStreamRef.current) {
      const videoTrack = localStreamRef.current.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setIsVideoMuted(!videoTrack.enabled);
      }
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white p-4">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-2xl font-bold mb-6 text-center">Taurai Video Call App</h1>
        
        {/* Call Initiation */}
        {!isCallActive && !isIncomingCall && (
          <div className="bg-gray-800 rounded-lg p-6 mb-6">
            <h2 className="text-xl mb-4">Start a Call</h2>
            <div className="flex gap-4">
              <input
                type="text"
                placeholder="Enter user ID to call"
                value={targetUserId}
                onChange={(e) => setTargetUserId(e.target.value)}
                className="flex-1 px-4 py-2 bg-gray-700 rounded-lg border border-gray-600 focus:outline-none focus:border-blue-500"
              />
              <button
                onClick={() => startCall(targetUserId)}
                disabled={!targetUserId.trim()}
                className="px-6 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-lg flex items-center gap-2"
              >
                <Phone size={20} />
                Call
              </button>
            </div>
          </div>
        )}
        
        {/* Incoming Call */}
        {isIncomingCall && (
          <div className="bg-blue-800 rounded-lg p-6 mb-6 text-center">
            <h2 className="text-xl mb-4">Incoming Call from {targetUserId}</h2>
            <div className="flex gap-4 justify-center">
              <button
                onClick={acceptCall}
                className="px-6 py-2 bg-green-600 hover:bg-green-700 rounded-lg flex items-center gap-2"
              >
                <Phone size={20} />
                Accept
              </button>
              <button
                onClick={rejectCall}
                className="px-6 py-2 bg-red-600 hover:bg-red-700 rounded-lg flex items-center gap-2"
              >
                <PhoneOff size={20} />
                Reject
              </button>
            </div>
          </div>
        )}
        
        {/* Call Status */}
        {callStatus !== 'idle' && (
          <div className="text-center mb-4">
            <span className="px-4 py-2 bg-gray-800 rounded-full">
              Status: {callStatus}
            </span>
          </div>
        )}
        
        {/* Video Call Interface */}
        {isCallActive && (
          <div className="space-y-4">
            {/* Video Containers */}
            <div className="relative bg-black rounded-lg overflow-hidden" style={{height: '400px'}}>
              {/* Remote Video */}
              <video
                ref={remoteVideoRef}
                autoPlay
                playsInline
                className="w-full h-full object-cover"
              />
              
              {/* Local Video (Picture-in-Picture) */}
              <div className="absolute top-4 right-4 w-32 h-24 bg-gray-800 rounded-lg overflow-hidden">
                <video
                  ref={localVideoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-cover"
                />
              </div>
            </div>
            
            {/* Call Controls */}
            <div className="flex justify-center gap-4">
              <button
                onClick={toggleAudio}
                className={`p-4 rounded-full ${isAudioMuted ? 'bg-red-600' : 'bg-gray-600'} hover:opacity-80`}
              >
                {isAudioMuted ? <MicOff size={24} /> : <Mic size={24} />}
              </button>
              
              <button
                onClick={toggleVideo}
                className={`p-4 rounded-full ${isVideoMuted ? 'bg-red-600' : 'bg-gray-600'} hover:opacity-80`}
              >
                {isVideoMuted ? <VideoOff size={24} /> : <Video size={24} />}
              </button>
              
              <button
                onClick={endCall}
                className="p-4 rounded-full bg-red-600 hover:bg-red-700"
              >
                <PhoneOff size={24} />
              </button>
            </div>
          </div>
        )}
        
        {/* Debug Info */}
        <div className="mt-8 p-4 bg-gray-800 rounded-lg">
          <h3 className="text-sm font-semibold mb-2">Debug Info:</h3>
          <p className="text-xs text-gray-400">Current User ID: {currentUserId}</p>
          <p className="text-xs text-gray-400">Call Status: {callStatus}</p>
          <p className="text-xs text-gray-400">Target User: {targetUserId}</p>
          <p className="text-xs text-gray-400">WebSocket: {websocketRef.current?.readyState === 1 ? 'Connected' : 'Disconnected'}</p>
        </div>
      </div>
    </div>
  );
};

export default VideoCall;