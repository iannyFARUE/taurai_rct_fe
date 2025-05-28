
import React, { useState, useRef, useEffect } from 'react';
import { Phone, PhoneOff, Mic, MicOff, Video, VideoOff, Users } from 'lucide-react';

const VideoCall = () => {
  const urlParams = new URLSearchParams(window.location.search);
  const [currentUserId, setCurrentUserId] = useState(urlParams.get('userId') || '');
  const [isUserSet, setIsUserSet] = useState(!!urlParams.get('userId'));
  
  const [isCallActive, setIsCallActive] = useState(false);
  const [isIncomingCall, setIsIncomingCall] = useState(false);
  const [isAudioMuted, setIsAudioMuted] = useState(false);
  const [isVideoMuted, setIsVideoMuted] = useState(false);
  const [callStatus, setCallStatus] = useState('idle');
  const [targetUserId, setTargetUserId] = useState('');
  const [debugLogs, setDebugLogs] = useState([]);
  const [incomingCallFrom, setIncomingCallFrom] = useState('');
  
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const peerConnectionRef = useRef(null);
  const websocketRef = useRef(null);
  const localStreamRef = useRef(null);
  const incomingOfferRef = useRef(null);
  
  // WebRTC configuration
  const rtcConfiguration = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ]
  };

  const addDebugLog = (message) => {
    const timestamp = new Date().toLocaleTimeString();
    setDebugLogs(prev => [...prev.slice(-20), `${timestamp}: ${message}`]);
    console.log(`[${currentUserId}] ${message}`);
  };

  useEffect(() => {
    if (isUserSet && currentUserId) {
      initializeWebSocket();
    }
    
    return () => {
      cleanup();
    };
  }, [isUserSet, currentUserId]);

  const cleanup = () => {
    if (websocketRef.current) {
      websocketRef.current.close();
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
    }
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
    }
  };

  const setUser = () => {
    if (currentUserId.trim()) {
      setIsUserSet(true);
      // Update URL for easy sharing/bookmarking
      window.history.replaceState({}, '', `?userId=${currentUserId}`);
    }
  };

  const initializeWebSocket = () => {
    const ws = new WebSocket(`ws://localhost:8080/call-signaling?userId=${currentUserId}`);
    
    ws.onopen = () => {
      addDebugLog('✅ WebSocket connected to server');
      setCallStatus('connected');
    };
    
    ws.onmessage = async (event) => {
      try {
        const message = JSON.parse(event.data);
        addDebugLog(`📨 Received: ${message.type} ${message.fromUserId ? 'from ' + message.fromUserId : ''}`);
        
        switch (message.type) {
          case 'connection-established':
            addDebugLog('🔗 Connection established with server');
            break;
          case 'call-offer':
            setIncomingCallFrom(message.fromUserId);
            incomingOfferRef.current = message.offer;
            setIsIncomingCall(true);
            setCallStatus('incoming');
            addDebugLog(`📞 Incoming call from ${message.fromUserId}`);
            break;
          case 'call-answer':
            await handleCallAnswer(message);
            break;
          case 'ice-candidate':
            await handleIceCandidate(message);
            break;
          case 'call-end':
            addDebugLog('📞 Call ended by remote user');
            handleCallEnd();
            break;
          case 'call-error':
            addDebugLog(`❌ Call error: ${message.message}`);
            setCallStatus('error');
            setTimeout(() => setCallStatus('connected'), 3000);
            break;
        }
      } catch (error) {
        addDebugLog(`❌ Error parsing message: ${error.message}`);
      }
    };
    
    ws.onerror = (error) => {
      addDebugLog('❌ WebSocket error');
      setCallStatus('error');
    };
    
    ws.onclose = () => {
      addDebugLog('🔌 WebSocket disconnected');
      setCallStatus('disconnected');
    };
    
    websocketRef.current = ws;
  };

    const initializeMediaDevices = async () => {
    try {
      addDebugLog('🎥 Requesting camera and microphone access...');
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true
      });
      
      localStreamRef.current = stream;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }
      
      addDebugLog('✅ Media devices initialized');
      return stream;
    } catch (error) {
      addDebugLog(`❌ Error accessing media devices: ${error.message}`);
      throw error;
    }
  };

  const createPeerConnection = () => {
    const pc = new RTCPeerConnection(rtcConfiguration);
    
    pc.onicecandidate = (event) => {
      if (event.candidate && websocketRef.current) {
        addDebugLog('🧊 Sending ICE candidate');
        websocketRef.current.send(JSON.stringify({
          type: 'ice-candidate',
          candidate: event.candidate,
          targetUserId: targetUserId || incomingCallFrom
        }));
      }
    };
    
    pc.ontrack = (event) => {
      addDebugLog('📡 Remote stream received');
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = event.streams[0];
      }
    };
    
    pc.onconnectionstatechange = () => {
      addDebugLog(`🔄 Connection state: ${pc.connectionState}`);
      if (pc.connectionState === 'connected') {
        setCallStatus('active');
        addDebugLog('🎉 Peer connection established!');
      } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        endCall();
      }
    };
    
    return pc;
  };

  const startCall = async (userId) => {
    try {
      if (!userId.trim()) {
        addDebugLog('❌ Please enter a user ID to call');
        return;
      }
      
      addDebugLog(`📞 Starting call to ${userId}`);
      setTargetUserId(userId);
      setCallStatus('calling');
      
      const stream = await initializeMediaDevices();
      const pc = createPeerConnection();
      
      stream.getTracks().forEach(track => {
        pc.addTrack(track, stream);
        addDebugLog(`➕ Added ${track.kind} track`);
      });
      
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      addDebugLog('📝 Created and set local offer');
      
      if (websocketRef.current && websocketRef.current.readyState === WebSocket.OPEN) {
        websocketRef.current.send(JSON.stringify({
          type: 'call-offer',
          offer: offer,
          targetUserId: userId
        }));
        addDebugLog(`📤 Sent call offer to ${userId}`);
      } else {
        throw new Error('WebSocket not connected');
      }
      
      peerConnectionRef.current = pc;
      setIsCallActive(true);
      
    } catch (error) {
      addDebugLog(`❌ Error starting call: ${error.message}`);
      setCallStatus('error');
      setTimeout(() => setCallStatus('connected'), 3000);
    }
  };

  const acceptCall = async () => {
    try {
      addDebugLog(`✅ Accepting call from ${incomingCallFrom}`);
      setIsIncomingCall(false);
      setIsCallActive(true);
      setCallStatus('connecting');
      setTargetUserId(incomingCallFrom);
      
      const stream = await initializeMediaDevices();
      const pc = createPeerConnection();
      
      stream.getTracks().forEach(track => {
        pc.addTrack(track, stream);
        addDebugLog(`➕ Added ${track.kind} track`);
      });
      
      await pc.setRemoteDescription(new RTCSessionDescription(incomingOfferRef.current));
      addDebugLog('📝 Set remote offer description');
      
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      addDebugLog('📝 Created and set local answer');
      
      if (websocketRef.current && websocketRef.current.readyState === WebSocket.OPEN) {
        websocketRef.current.send(JSON.stringify({
          type: 'call-answer',
          answer: answer,
          targetUserId: incomingCallFrom
        }));
        addDebugLog(`📤 Sent call answer to ${incomingCallFrom}`);
      }
      
      peerConnectionRef.current = pc;
      
    } catch (error) {
      addDebugLog(`❌ Error accepting call: ${error.message}`);
      setCallStatus('error');
    }
  };

  const handleCallAnswer = async (message) => {
    try {
      if (peerConnectionRef.current) {
        await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(message.answer));
        addDebugLog('📝 Set remote answer description');
        setCallStatus('active');
      }
    } catch (error) {
      addDebugLog(`❌ Error handling call answer: ${error.message}`);
    }
  };

  const handleIceCandidate = async (message) => {
    try {
      if (peerConnectionRef.current && message.candidate) {
        await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(message.candidate));
        addDebugLog('🧊 Added ICE candidate');
      }
    } catch (error) {
      addDebugLog(`❌ Error handling ICE candidate: ${error.message}`);
    }
  };

  const rejectCall = () => {
    addDebugLog(`❌ Rejecting call from ${incomingCallFrom}`);
    setIsIncomingCall(false);
    setCallStatus('connected');
    
    if (websocketRef.current) {
      websocketRef.current.send(JSON.stringify({
        type: 'call-end',
        targetUserId: incomingCallFrom
      }));
    }
    
    setIncomingCallFrom('');
  };

  const endCall = () => {
    addDebugLog('📞 Ending call');
    setIsCallActive(false);
    setCallStatus('connected');
    
    if (websocketRef.current && (targetUserId || incomingCallFrom)) {
      websocketRef.current.send(JSON.stringify({
        type: 'call-end',
        targetUserId: targetUserId || incomingCallFrom
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
    
    setTargetUserId('');
    setIncomingCallFrom('');
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
        addDebugLog(`🎤 Audio ${audioTrack.enabled ? 'unmuted' : 'muted'}`);
      }
    }
  };

  const toggleVideo = () => {
    if (localStreamRef.current) {
      const videoTrack = localStreamRef.current.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setIsVideoMuted(!videoTrack.enabled);
        addDebugLog(`📹 Video ${videoTrack.enabled ? 'enabled' : 'disabled'}`);
      }
    }
  };

  // User setup screen
  if (!isUserSet) {
    return (
      <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center">
        <div className="bg-gray-800 p-8 rounded-lg max-w-md w-full">
          <div className="text-center mb-6">
            <Users size={48} className="mx-auto mb-4 text-blue-500" />
            <h1 className="text-2xl font-bold mb-2">WebRTC Call App</h1>
            <p className="text-gray-400">Enter your user ID to start</p>
          </div>
          
          <div className="space-y-4">
            <input
              type="text"
              placeholder="Enter your user ID (e.g., alice, bob, charlie)"
              value={currentUserId}
              onChange={(e) => setCurrentUserId(e.target.value)}
              className="w-full px-4 py-3 bg-gray-700 rounded-lg border border-gray-600 focus:outline-none focus:border-blue-500"
              onKeyPress={(e) => e.key === 'Enter' && setUser()}
            />
            
            <button
              onClick={setUser}
              disabled={!currentUserId.trim()}
              className="w-full px-4 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-lg font-semibold"
            >
              Connect
            </button>
            
            <div className="text-sm text-gray-400">
              <p className="mb-2">💡 <strong>Testing tip:</strong></p>
              <p>Open multiple tabs with different user IDs:</p>
              <ul className="list-disc list-inside mt-1 space-y-1">
                <li>Tab 1: alice</li>
                <li>Tab 2: bob</li>
                <li>Tab 3: charlie</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white p-4">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-bold">WebRTC Call App</h1>
          <div className="flex items-center gap-4">
            <span className="text-blue-400 font-semibold">User: {currentUserId}</span>
            <div className={`w-3 h-3 rounded-full ${
              callStatus === 'connected' ? 'bg-green-500' : 
              callStatus === 'disconnected' ? 'bg-red-500' : 
              'bg-yellow-500'
            }`}></div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Call Interface */}
          <div className="lg:col-span-2 space-y-6">
            {/* Call Initiation */}
            {!isCallActive && !isIncomingCall && callStatus === 'connected' && (
              <div className="bg-gray-800 rounded-lg p-6">
                <h2 className="text-xl mb-4">Start a Call</h2>
                <div className="flex gap-4">
                  <input
                    type="text"
                    placeholder="Enter user ID to call"
                    value={targetUserId}
                    onChange={(e) => setTargetUserId(e.target.value)}
                    className="flex-1 px-4 py-2 bg-gray-700 rounded-lg border border-gray-600 focus:outline-none focus:border-blue-500"
                    onKeyPress={(e) => e.key === 'Enter' && startCall(targetUserId)}
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
                
                <div className="mt-4">
                  <p className="text-sm text-gray-400 mb-2">Quick test users:</p>
                  <div className="flex gap-2">
                    {['alice', 'bob', 'charlie', 'david'].filter(user => user !== currentUserId).map(user => (
                      <button
                        key={user}
                        onClick={() => setTargetUserId(user)}
                        className="px-3 py-1 text-sm bg-gray-600 hover:bg-gray-500 rounded"
                      >
                        {user}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
            
            {/* Incoming Call */}
            {isIncomingCall && (
              <div className="bg-blue-800 rounded-lg p-6 text-center animate-pulse">
                <h2 className="text-xl mb-4">📞 Incoming Call</h2>
                <p className="text-lg mb-6">From: <strong>{incomingCallFrom}</strong></p>
                <div className="flex gap-4 justify-center">
                  <button
                    onClick={acceptCall}
                    className="px-6 py-3 bg-green-600 hover:bg-green-700 rounded-lg flex items-center gap-2 text-lg"
                  >
                    <Phone size={24} />
                    Accept
                  </button>
                  <button
                    onClick={rejectCall}
                    className="px-6 py-3 bg-red-600 hover:bg-red-700 rounded-lg flex items-center gap-2 text-lg"
                  >
                    <PhoneOff size={24} />
                    Reject
                  </button>
                </div>
              </div>
            )}
            
            {/* Call Status */}
            {(callStatus === 'calling' || callStatus === 'connecting') && (
              <div className="text-center">
                <div className="inline-flex items-center px-6 py-3 bg-yellow-800 rounded-full">
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white mr-3"></div>
                  {callStatus === 'calling' ? `Calling ${targetUserId}...` : 'Connecting...'}
                </div>
              </div>
            )}
            
            {/* Video Call Interface */}
            {isCallActive && (
              <div className="space-y-4">
                {/* Video Containers */}
                <div className="relative bg-black rounded-lg overflow-hidden aspect-video">
                  {/* Remote Video */}
                  <video
                    ref={remoteVideoRef}
                    autoPlay
                    playsInline
                    className="w-full h-full object-cover"
                  />
                  
                  {/* Local Video (Picture-in-Picture) */}
                  <div className="absolute top-4 right-4 w-32 h-24 bg-gray-800 rounded-lg overflow-hidden border-2 border-gray-600">
                    <video
                      ref={localVideoRef}
                      autoPlay
                      playsInline
                      muted
                      className="w-full h-full object-cover"
                    />
                  </div>
                  
                  {/* Call Info Overlay */}
                  <div className="absolute top-4 left-4 bg-black bg-opacity-50 px-3 py-2 rounded">
                    <p className="text-sm">
                      {callStatus === 'active' ? '🟢 Connected' : '🟡 Connecting...'}
                    </p>
                    <p className="text-xs text-gray-300">
                      With: {targetUserId || incomingCallFrom}
                    </p>
                  </div>
                </div>
                
                {/* Call Controls */}
                <div className="flex justify-center gap-4">
                  <button
                    onClick={toggleAudio}
                    className={`p-4 rounded-full transition-colors ${
                      isAudioMuted ? 'bg-red-600 hover:bg-red-700' : 'bg-gray-600 hover:bg-gray-700'
                    }`}
                    title={isAudioMuted ? 'Unmute' : 'Mute'}
                  >
                    {isAudioMuted ? <MicOff size={24} /> : <Mic size={24} />}
                  </button>
                  
                  <button
                    onClick={toggleVideo}
                    className={`p-4 rounded-full transition-colors ${
                      isVideoMuted ? 'bg-red-600 hover:bg-red-700' : 'bg-gray-600 hover:bg-gray-700'
                    }`}
                    title={isVideoMuted ? 'Turn on camera' : 'Turn off camera'}
                  >
                    {isVideoMuted ? <VideoOff size={24} /> : <Video size={24} />}
                  </button>
                  
                  <button
                    onClick={endCall}
                    className="p-4 rounded-full bg-red-600 hover:bg-red-700 transition-colors"
                    title="End call"
                  >
                    <PhoneOff size={24} />
                  </button>
                </div>
              </div>
            )}
            
            {/* Connection Status Messages */}
            {callStatus === 'error' && (
              <div className="bg-red-800 border border-red-600 rounded-lg p-4 text-center">
                <p className="text-red-200">❌ Connection error. Please try again.</p>
              </div>
            )}
            
            {callStatus === 'disconnected' && (
              <div className="bg-yellow-800 border border-yellow-600 rounded-lg p-4 text-center">
                <p className="text-yellow-200">🔌 Disconnected from server. Attempting to reconnect...</p>
                <button 
                  onClick={initializeWebSocket}
                  className="mt-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded"
                >
                  Reconnect
                </button>
              </div>
            )}
          </div>
          
          {/* Debug Panel */}
          <div className="space-y-4">
            {/* Status Panel */}
            <div className="bg-gray-800 rounded-lg p-4">
              <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                📊 Status
              </h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-400">User ID:</span>
                  <span className="font-mono">{currentUserId}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Connection:</span>
                  <span className={`font-semibold ${
                    callStatus === 'connected' ? 'text-green-400' : 
                    callStatus === 'error' ? 'text-red-400' : 
                    'text-yellow-400'
                  }`}>
                    {callStatus}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Target User:</span>
                  <span className="font-mono">{targetUserId || incomingCallFrom || 'None'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Audio:</span>
                  <span className={isAudioMuted ? 'text-red-400' : 'text-green-400'}>
                    {isAudioMuted ? '🔇 Muted' : '🔊 Active'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Video:</span>
                  <span className={isVideoMuted ? 'text-red-400' : 'text-green-400'}>
                    {isVideoMuted ? '📹 Off' : '📷 On'}
                  </span>
                </div>
              </div>
            </div>
            
            {/* Debug Logs */}
            <div className="bg-gray-800 rounded-lg p-4">
              <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                🐛 Debug Logs
              </h3>
              <div className="bg-black rounded p-3 text-xs font-mono max-h-64 overflow-y-auto">
                {debugLogs.length === 0 ? (
                  <div className="text-gray-500 italic">No logs yet...</div>
                ) : (
                  debugLogs.map((log, index) => (
                    <div key={index} className="text-green-400 mb-1 break-all">
                      {log}
                    </div>
                  ))
                )}
              </div>
              <button
                onClick={() => setDebugLogs([])}
                className="mt-2 px-3 py-1 text-xs bg-gray-600 hover:bg-gray-700 rounded"
              >
                Clear Logs
              </button>
            </div>
            
            {/* Instructions */}
            <div className="bg-gray-800 rounded-lg p-4">
              <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                📋 Instructions
              </h3>
              <div className="text-sm space-y-2 text-gray-300">
                <p><strong>To test locally:</strong></p>
                <ol className="list-decimal list-inside space-y-1 ml-2">
                  <li>Start your Spring Boot server</li>
                  <li>Open multiple browser tabs</li>
                  <li>Use different user IDs (alice, bob, etc.)</li>
                  <li>Make calls between the tabs</li>
                </ol>
                
                <p className="mt-3"><strong>URLs for testing:</strong></p>
                <div className="bg-black rounded p-2 text-xs font-mono">
                  <div>?userId=alice</div>
                  <div>?userId=bob</div>
                  <div>?userId=charlie</div>
                </div>
                
                <p className="mt-3 text-xs text-gray-400">
                  💡 Grant camera/microphone permissions when prompted
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default VideoCall;