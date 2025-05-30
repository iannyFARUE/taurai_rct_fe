import React, { useState, useRef, useEffect } from 'react';
import { Phone, PhoneOff, Mic, MicOff, Video, VideoOff, Users, LogOut, User } from 'lucide-react';
import API_CONFIG from '../config/api';

const VideoCallApp = () => {
  const API_BASE_URL = API_CONFIG.BASE_URL;
const WS_URL = API_CONFIG.WS_URL;
  // Authentication state
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authToken, setAuthToken] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [showLogin, setShowLogin] = useState(true);
  
  // Login/Register form state
  const [loginData, setLoginData] = useState({ email: '', password: '' });
  const [registerData, setRegisterData] = useState({
    firstname: '',lastname:'', email: '', password: '',
  });
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState('');
  
  // Call state
  const [isCallActive, setIsCallActive] = useState(false);
  const [isIncomingCall, setIsIncomingCall] = useState(false);
  const [isAudioMuted, setIsAudioMuted] = useState(false);
  const [isVideoMuted, setIsVideoMuted] = useState(false);
  const [callStatus, setCallStatus] = useState('idle');
  const [targetUserId, setTargetUserId] = useState('');
  const [incomingCallFrom, setIncomingCallFrom] = useState(null);
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [debugLogs, setDebugLogs] = useState([]);
  
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
    console.log(`[${currentUser?.username}] ${message}`);
  };

  // Check for existing token on component mount
  useEffect(() => {
    const token = localStorage.getItem('authToken');
    const userData = localStorage.getItem('userData');
 
    
    if (token && userData) {
      validateToken(token, JSON.parse(userData));
    }
  }, []);

  // Initialize WebSocket when authenticated
  useEffect(() => {
    if (isAuthenticated && authToken) {
      initializeWebSocket();
    }
    
    return () => {
      cleanup();
    };
  }, [isAuthenticated, authToken]);

  const validateToken = async (token, userData) => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/v1/auth/validate-token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ token })
      });
      
      if (response.ok) {
        const data = await response.json();
        setAuthToken(token);
        setCurrentUser(data.user_info);
        setIsAuthenticated(true);
        addDebugLog('Token validated successfully');
      } else {
        // Token invalid, clear storage
        localStorage.removeItem('authToken');
        localStorage.removeItem('userData');
      }
    } catch (error) {
      console.error('Token validation failed:', error);
      localStorage.removeItem('authToken');
      localStorage.removeItem('userData');
    }
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setAuthLoading(true);
    setAuthError('');
    
    try {
      const response = await fetch(`${API_BASE_URL}/api/v1/auth/authenticate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(loginData)
      });
      
      const data = await response.json();
      
      if (response.ok) {
        setAuthToken(data.access_token);
        setCurrentUser(data.user_info);
        setIsAuthenticated(true);
        
        // Store in localStorage
        localStorage.setItem('authToken', data.access_token);
        localStorage.setItem('userData', JSON.stringify(data.user_info));
        
        addDebugLog('Login successful');
      } else {
        setAuthError(data.message || 'Login failed');
      }
    } catch (error) {
      setAuthError('Login failed: ' + error.message);
    }
    
    setAuthLoading(false);
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    setAuthLoading(true);
    setAuthError('');
    
    try {
      const response = await fetch(`${API_BASE_URL}/api/v1/auth/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(registerData)
      });
      
      const data = await response.json();
      
      if (response.ok) {
        setAuthToken(data.access_token);
        setCurrentUser(data.user_info);
        setIsAuthenticated(true);
        
        // Store in localStorage
        localStorage.setItem('authToken', data.access_token);
        localStorage.setItem('userData', JSON.stringify(data.user_info));
        
        addDebugLog('Registration successful');
      } else {
        setAuthError(data.message || 'Registration failed');
      }
    } catch (error) {
      setAuthError('Registration failed: ' + error.message);
    }
    
    setAuthLoading(false);
  };

  const handleLogout = () => {
    setIsAuthenticated(false);
    setAuthToken(null);
    setCurrentUser(null);
    setOnlineUsers([]);
    localStorage.removeItem('authToken');
    localStorage.removeItem('userData');
    
    if (websocketRef.current) {
      websocketRef.current.close();
    }
    
    cleanup();
    addDebugLog('Logged out successfully');
  };

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

  const initializeWebSocket = () => {
    const ws = new WebSocket(`${WS_URL}?token=${authToken}`);
    
    ws.onopen = () => {
      addDebugLog('✅ WebSocket connected to server');
      setCallStatus('connected');
    };
    
    ws.onmessage = async (event) => {
      try {
        const message = JSON.parse(event.data);
        addDebugLog(`📨 Received: ${message.type}`);
        
        switch (message.type) {
          case 'connection-established':
            addDebugLog(`🔗 Connected as ${message.username}`);
            // Request online users list
            ws.send(JSON.stringify({ type: 'get-online-users' }));
            break;
          case 'online-users':
            setOnlineUsers(message.users || []);
            addDebugLog(`👥 ${message.users?.length || 0} users online`);
            break;
          case 'call-offer':
            setIncomingCallFrom({
              userId: message.fromUserId,
              username: message.fromUsername,
              fullName: message.callerFullName
            });
            incomingOfferRef.current = message.offer;
            setIsIncomingCall(true);
            setCallStatus('incoming');
            addDebugLog(`📞 Incoming call from ${message.fromUsername}`);
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
    
    ws.onclose = (event) => {
      addDebugLog(`🔌 WebSocket disconnected: ${event.reason}`);
      setCallStatus('disconnected');
      if (event.code === 1006) { // Abnormal closure
        addDebugLog('🔄 Attempting to reconnect...');
        setTimeout(() => {
          if (isAuthenticated && authToken) {
            initializeWebSocket();
          }
        }, 3000);
      }
    };
    
    websocketRef.current = ws;
  };

  const startCall = async (userId) => {
    try {
      console.log("=== START CALL DEBUG ===");
      console.log("userId parameter:", userId);
      console.log("Current targetUserId state:", targetUserId);
      console.log("Current incomingCallFrom:", incomingCallFrom);
      
      addDebugLog(`📞 Starting call to ${userId}`);
      setTargetUserId(userId);
      setCallStatus('calling');
      
      // Wait a moment for state to update (though this shouldn't be necessary)
      console.log("About to call initializeMediaDevices...");
      const stream = await initializeMediaDevices();
      
      console.log("About to create peer connection with userId:", userId);
      const pc = createPeerConnection(userId); // Pass userId as parameter
      
      stream.getTracks().forEach(track => {
        pc.addTrack(track, stream);
        console.log(`Added ${track.kind} track to peer connection`);
      });
      
      console.log("Creating offer...");
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      console.log("Offer created and set as local description");
      
      if (websocketRef.current && websocketRef.current.readyState === WebSocket.OPEN) {
        console.log("Sending call offer via WebSocket to:", userId);
        websocketRef.current.send(JSON.stringify({
          type: 'call-offer',
          offer: offer,
          targetUserId: userId
        }));
        addDebugLog(`📤 Sent call offer to ${userId}`);
      } else {
        console.error("WebSocket not ready:", websocketRef.current?.readyState);
      }
      
      peerConnectionRef.current = pc;
      setIsCallActive(true);
      console.log("=== START CALL COMPLETE ===");
      
    } catch (error) {
      console.error("Error in startCall:", error);
      addDebugLog(`❌ Error starting call: ${error.message}`);
      setCallStatus('error');
      setTimeout(() => setCallStatus('connected'), 3000);
    }
  };

  const initializeMediaDevices = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true
    });
    
    localStreamRef.current = stream;
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = stream;
    }
    
    return stream;
  };

  const createPeerConnection = (targetUser) => {
    const pc = new RTCPeerConnection(rtcConfiguration);
    
    console.log("Creating peer connection with target:", targetUser);
    console.log("State targetUserId:", targetUserId);
    console.log("State incomingCallFrom:", incomingCallFrom?.userId);
    
    pc.onicecandidate = (event) => {
      if (event.candidate && websocketRef.current) {
        console.log("ICE candidate - using targetUser:", targetUser);
        addDebugLog(`🧊 Sending ICE candidate to ${targetUser}`);
        
        if (!targetUser) {
          addDebugLog('❌ ERROR: No target user ID for ICE candidate!');
          console.error('No target user ID available for ICE candidate');
          return;
        }
        
        websocketRef.current.send(JSON.stringify({
          type: 'ice-candidate',
          candidate: event.candidate,
          targetUserId: targetUser
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

  const acceptCall = async () => {
    try {
      const callerId = incomingCallFrom?.userId;
      addDebugLog(`✅ Accepting call from ${incomingCallFrom?.username} (ID: ${callerId})`);
      
      if (!callerId) {
        addDebugLog('❌ ERROR: No caller ID available!');
        return;
      }
      
      setIsIncomingCall(false);
      setIsCallActive(true);
      setCallStatus('connecting');
      
      // Set the target user ID to the incoming caller
      setTargetUserId(callerId);
      
      const stream = await initializeMediaDevices();
      const pc = createPeerConnection(callerId); // Pass callerId as parameter
      
      stream.getTracks().forEach(track => {
        pc.addTrack(track, stream);
      });
      
      await pc.setRemoteDescription(new RTCSessionDescription(incomingOfferRef.current));
      
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      
      if (websocketRef.current && websocketRef.current.readyState === WebSocket.OPEN) {
        websocketRef.current.send(JSON.stringify({
          type: 'call-answer',
          answer: answer,
          targetUserId: callerId
        }));
        addDebugLog(`📤 Sent call answer to ${callerId}`);
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
      }
    } catch (error) {
      addDebugLog(`❌ Error handling ICE candidate: ${error.message}`);
    }
  };

  const rejectCall = () => {
    addDebugLog(`❌ Rejecting call from ${incomingCallFrom?.username}`);
    setIsIncomingCall(false);
    setCallStatus('connected');
    
    if (websocketRef.current) {
      websocketRef.current.send(JSON.stringify({
        type: 'call-end',
        targetUserId: incomingCallFrom?.userId
      }));
    }
    
    setIncomingCallFrom(null);
  };

  const endCall = () => {
    addDebugLog('📞 Ending call');
    setIsCallActive(false);
    setCallStatus('connected');
    
    if (websocketRef.current && (targetUserId || incomingCallFrom?.userId)) {
      websocketRef.current.send(JSON.stringify({
        type: 'call-end',
        targetUserId: targetUserId || incomingCallFrom?.userId
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
    setIncomingCallFrom(null);
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

  // Authentication UI
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center">
        <div className="bg-gray-800 p-8 rounded-lg max-w-md w-full">
          <div className="text-center mb-6">
            <Users size={48} className="mx-auto mb-4 text-blue-500" />
            <h1 className="text-2xl font-bold mb-2">Taurai Video Call</h1>
            <p className="text-gray-400">
              {showLogin ? 'Sign in to start calling' : 'Create your account'}
            </p>
          </div>
          
          {authError && (
            <div className="bg-red-800 border border-red-600 rounded p-3 mb-4 text-sm">
              {authError}
            </div>
          )}
          
          {showLogin ? (
            <form onSubmit={handleLogin} className="space-y-4">
              <input
                type="text"
                placeholder="Email"
                value={loginData.username}
                onChange={(e) => setLoginData({...loginData, email: e.target.value})}
                className="w-full px-4 py-3 bg-gray-700 rounded-lg border border-gray-600 focus:outline-none focus:border-blue-500"
                required
              />
              <input
                type="password"
                placeholder="Password"
                value={loginData.password}
                onChange={(e) => setLoginData({...loginData, password: e.target.value})}
                className="w-full px-4 py-3 bg-gray-700 rounded-lg border border-gray-600 focus:outline-none focus:border-blue-500"
                required
              />
              <button
                type="submit"
                disabled={authLoading}
                className="w-full px-4 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 rounded-lg font-semibold"
              >
                {authLoading ? 'Signing in...' : 'Sign In'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleRegister} className="space-y-4">
              <input
                type="text"
                placeholder="First Name"
                value={registerData.fullName}
                onChange={(e) => setRegisterData({...registerData, firstname: e.target.value})}
                className="w-full px-4 py-3 bg-gray-700 rounded-lg border border-gray-600 focus:outline-none focus:border-blue-500"
                required
              />
                            <input
                type="text"
                placeholder="Last Name"
                value={registerData.fullName}
                onChange={(e) => setRegisterData({...registerData, lastname: e.target.value})}
                className="w-full px-4 py-3 bg-gray-700 rounded-lg border border-gray-600 focus:outline-none focus:border-blue-500"
                required
              />
              <input
                type="email"
                placeholder="Email"
                value={registerData.email}
                onChange={(e) => setRegisterData({...registerData, email: e.target.value})}
                className="w-full px-4 py-3 bg-gray-700 rounded-lg border border-gray-600 focus:outline-none focus:border-blue-500"
                required
              />
              <input
                type="password"
                placeholder="Password"
                value={registerData.password}
                onChange={(e) => setRegisterData({...registerData, password: e.target.value})}
                className="w-full px-4 py-3 bg-gray-700 rounded-lg border border-gray-600 focus:outline-none focus:border-blue-500"
                required
              />
              <button
                type="submit"
                disabled={authLoading}
                className="w-full px-4 py-3 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 rounded-lg font-semibold"
              >
                {authLoading ? 'Creating Account...' : 'Create Account'}
              </button>
            </form>
          )}
          
          <div className="mt-4 text-center">
            <button
              onClick={() => {
                setShowLogin(!showLogin);
                setAuthError('');
              }}
              className="text-blue-400 hover:text-blue-300 text-sm"
            >
              {showLogin ? "Don't have an account? Sign up" : "Already have an account? Sign in"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Main authenticated UI
  return (
    <div className="min-h-screen bg-gray-900 text-white p-4">
      <div className="max-w-6xl mx-auto">
        {/* Header with user info */}
        <div className="flex justify-between items-center mb-6 bg-gray-800 rounded-lg p-4">
          <div>
            <h1 className="text-2xl font-bold">Taurai Video Call</h1>
            <p className="text-gray-400">Welcome, {currentUser?.fullName}</p>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <User size={20} className="text-blue-400" />
              <span className="text-sm">{currentUser?.username}</span>
            </div>
            <div className={`w-3 h-3 rounded-full ${
              callStatus === 'connected' ? 'bg-green-500' : 
              callStatus === 'disconnected' ? 'bg-red-500' : 
              'bg-yellow-500'
            }`}></div>
            <button
              onClick={handleLogout}
              className="flex items-center gap-2 px-3 py-2 bg-red-600 hover:bg-red-700 rounded text-sm"
            >
              <LogOut size={16} />
              Logout
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Call Interface */}
          <div className="lg:col-span-2 space-y-6">
            {/* Online Users */}
            {!isCallActive && !isIncomingCall && callStatus === 'connected' && (
              <div className="bg-gray-800 rounded-lg p-6">
                <h2 className="text-xl mb-4 flex items-center gap-2">
                  <Users size={24} />
                  Online Users ({onlineUsers.length})
                </h2>
                {onlineUsers.length === 0 ? (
                  <p className="text-gray-400 text-center py-8">
                    No other users online. Invite friends to join!
                  </p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {onlineUsers.map(user => (
                      <div key={user.userId} className="bg-gray-700 rounded-lg p-4 flex items-center justify-between">
                        <div>
                          <p className="font-semibold">{user.fullName}</p>
                          <p className="text-sm text-gray-400">@{user.username}</p>
                        </div>
                        <button
                          onClick={() => startCall(user.userId)}
                          className="px-4 py-2 bg-green-600 hover:bg-green-700 rounded-lg flex items-center gap-2"
                        >
                          <Phone size={16} />
                          Call
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            
            {/* Incoming Call */}
            {isIncomingCall && incomingCallFrom && (
              <div className="bg-blue-800 rounded-lg p-6 text-center animate-pulse">
                <h2 className="text-xl mb-2">📞 Incoming Call</h2>
                <div className="mb-6">
                  <p className="text-lg font-semibold">{incomingCallFrom.fullName}</p>
                  <p className="text-blue-200">@{incomingCallFrom.username}</p>
                </div>
                <div className="flex gap-4 justify-center">
                  <button
                    onClick={acceptCall}
                    className="px-8 py-4 bg-green-600 hover:bg-green-700 rounded-lg flex items-center gap-2 text-lg"
                  >
                    <Phone size={24} />
                    Accept
                  </button>
                  <button
                    onClick={rejectCall}
                    className="px-8 py-4 bg-red-600 hover:bg-red-700 rounded-lg flex items-center gap-2 text-lg"
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
                  {callStatus === 'calling' ? 'Calling...' : 'Connecting...'}
                </div>
              </div>
            )}
            
            {/* Video Call Interface */}
            {isCallActive && (
              <div className="space-y-4">
                <div className="relative bg-black rounded-lg overflow-hidden aspect-video">
                  <video
                    ref={remoteVideoRef}
                    autoPlay
                    playsInline
                    className="w-full h-full object-cover"
                  />
                  
                  <div className="absolute top-4 right-4 w-32 h-24 bg-gray-800 rounded-lg overflow-hidden border-2 border-gray-600">
                    <video
                      ref={localVideoRef}
                      autoPlay
                      playsInline
                      muted
                      className="w-full h-full object-cover"
                    />
                  </div>
                  
                  <div className="absolute top-4 left-4 bg-black bg-opacity-50 px-3 py-2 rounded">
                    <p className="text-sm">
                      {callStatus === 'active' ? '🟢 Connected' : '🟡 Connecting...'}
                    </p>
                  </div>
                </div>
                
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
                <p className="text-yellow-200">🔌 Disconnected from server. Reconnecting...</p>
              </div>
            )}
          </div>
          
          {/* Debug Panel */}
          <div className="space-y-4">
            <div className="bg-gray-800 rounded-lg p-4">
              <h3 className="text-lg font-semibold mb-3">📊 Status</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-400">User:</span>
                  <span>{currentUser?.username}</span>
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
                  <span className="text-gray-400">Online Users:</span>
                  <span>{onlineUsers.length}</span>
                </div>
              </div>
            </div>
            
            <div className="bg-gray-800 rounded-lg p-4">
              <h3 className="text-lg font-semibold mb-3">🐛 Debug Logs</h3>
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
                Clear
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default VideoCallApp