import { useEffect, useMemo, useRef, useState } from 'react'
import { Room, RoomEvent, Track } from 'livekit-client'

function decodeInviteFromUrl() {
  const params = new URLSearchParams(window.location.search)
  const raw = params.get('invite')
  if (!raw) return null
  try {
    const normalized = raw.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
    return JSON.parse(atob(padded))
  } catch {
    return null
  }
}

function TrackVideo({ track, className = 'track-video' }) {
  const ref = useRef(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    if (!track?.mediaStreamTrack) {
      el.srcObject = null
      return
    }

    el.srcObject = new MediaStream([track.mediaStreamTrack])
    el.play().catch(() => {})

    return () => {
      el.srcObject = null
    }
  }, [track])

  return <video ref={ref} className={className} autoPlay playsInline muted={false} />
}

function getVideoPublication(participant) {
  return Array.from(participant.videoTrackPublications.values())[0] || null
}

function getDisplayName(participant, fallback = 'Участник') {
  const attrName = participant?.attributes?.display_name || participant?.attributes?.displayName

  let metadataName = ''
  try {
    const metadata = JSON.parse(participant?.metadata || '{}')
    metadataName = metadata.display_name || metadata.displayName || metadata.full_name || metadata.name || ''
  } catch {
    metadataName = ''
  }

  return attrName || metadataName || participant.name || participant.identity || fallback
}

export function App() {
  const inviteData = useMemo(() => decodeInviteFromUrl(), [])

  const [theme, setTheme] = useState('dark')
  const [adminAuth, setAdminAuth] = useState({ login: '', password: '' })
  const [adminLoggedIn, setAdminLoggedIn] = useState(false)
  const [adminError, setAdminError] = useState('')
  const [generatedInvite, setGeneratedInvite] = useState('')
  const [copyStatus, setCopyStatus] = useState('')

  const [serverUrl, setServerUrl] = useState('wss://personzroomz-a7chety0.livekit.cloud')
  const [apiBaseUrl, setApiBaseUrl] = useState('http://185.219.7.21:8000')
  const [roomName, setRoomName] = useState('private-video-room')
  const [participantId, setParticipantId] = useState('P1')
  const [conferenceTopic, setConferenceTopic] = useState('Конференция')
  const [mode, setMode] = useState('deny_list')
  const [chatEnabled, setChatEnabled] = useState(true)
  const [uniqueLink, setUniqueLink] = useState(true)
  const [allowList, setAllowList] = useState('')
  const [denyList, setDenyList] = useState('')
  const [allList, setAllList] = useState('')

  const [displayNameInput, setDisplayNameInput] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [status, setStatus] = useState('Не подключено')
  const [error, setError] = useState('')
  const [warning, setWarning] = useState('')
  const [connected, setConnected] = useState(false)
  const [cameraEnabled, setCameraEnabled] = useState(true)
  const [micEnabled, setMicEnabled] = useState(true)
  const [speakerVolume] = useState(100)
  const [chatInput, setChatInput] = useState('')
  const [chatMessages, setChatMessages] = useState([])
  const [personalMessages, setPersonalMessages] = useState([])
  const [activeChatTab, setActiveChatTab] = useState('group')
  const [noVideoWarning, setNoVideoWarning] = useState('')
  const [participantTiles, setParticipantTiles] = useState([])
  const [selectedTileId, setSelectedTileId] = useState('')

  const roomRef = useRef(null)
  const chatPollRef = useRef(null)
  const chatScrollRef = useRef(null)
  const hiddenAudioRef = useRef(null)
  const visibleIdsRef = useRef([])
  const denyIdsRef = useRef([])
  const displayNameByIdentityRef = useRef({})

  function isVisibleForInvite(identity) {
    const visible = visibleIdsRef.current
    const blocked = denyIdsRef.current

    if (visible.length > 0) {
      return visible.includes(identity)
    }
    return !blocked.includes(identity)
  }

  const selectedTile = participantTiles.find((tile) => tile.id === selectedTileId) || participantTiles[0] || null

  const displayedMessages = activeChatTab === 'group'
    ? chatMessages.filter((m) => {
        const senderId = (m.sender || '').trim()
        if (senderId === '' || senderId === (roomRef.current?.localParticipant?.identity || '')) return true
        return isVisibleForInvite(senderId)
      })
    : personalMessages

  const [callDurationSec, setCallDurationSec] = useState(0)

  const callDurationLabel = useMemo(() => {
    const hh = String(Math.floor(callDurationSec / 3600)).padStart(2, '0')
    const mm = String(Math.floor((callDurationSec % 3600) / 60)).padStart(2, '0')
    const ss = String(callDurationSec % 60).padStart(2, '0')
    return `${hh}:${mm}:${ss}`
  }, [callDurationSec])

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  useEffect(() => {
    if (!connected) {
      setCallDurationSec(0)
      return
    }

    const startedAt = Date.now()
    const timer = setInterval(() => {
      const seconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000))
      setCallDurationSec(seconds)
    }, 1000)

    return () => clearInterval(timer)
  }, [connected])

  useEffect(() => {
    if (inviteData) {
      setServerUrl(inviteData.livekit_url)
      setApiBaseUrl(inviteData.api_base_url)
      setRoomName(inviteData.room_name)
      setParticipantId(inviteData.participant_id)
      setConferenceTopic(inviteData.conference_topic || 'Конференция')
      denyIdsRef.current = inviteData.deny_video_participants || []
    }
  }, [inviteData])

  useEffect(() => {
    const audioElements = Array.from(document.querySelectorAll('audio'))
    audioElements.forEach((el) => {
      el.volume = speakerVolume / 100
    })
  }, [speakerVolume])

  useEffect(() => {
    const node = chatScrollRef.current
    if (!node) return
    node.scrollTo({ top: node.scrollHeight, behavior: 'smooth' })
  }, [displayedMessages, activeChatTab])

  useEffect(() => {
    return () => {
      if (chatPollRef.current) clearInterval(chatPollRef.current)
      if (roomRef.current) roomRef.current.disconnect()
    }
  }, [])

  function adminAuthHeader() {
    return `Basic ${btoa(`${adminAuth.login}:${adminAuth.password}`)}`
  }

  function getMappedDisplayName(identity) {
    if (!identity) return ''
    return displayNameByIdentityRef.current?.[identity] || ''
  }

  function rememberDisplayName(identity, name) {
    if (!identity || !name) return
    displayNameByIdentityRef.current = {
      ...displayNameByIdentityRef.current,
      [identity]: name,
    }
  }

  function rebuildParticipantTiles(room) {
    if (!room) {
      setParticipantTiles([])
      setSelectedTileId('')
      return
    }

    const tiles = []

    const localIdentity = room.localParticipant.identity || inviteData?.participant_id || 'Вы'
    const localName = displayName || getMappedDisplayName(localIdentity) || getDisplayName(room.localParticipant, localIdentity || 'Вы') || localIdentity || 'Вы'
    const localVideoPub = getVideoPublication(room.localParticipant)
    const localTrack = localVideoPub?.track || null

    tiles.push({
      id: `local-${localIdentity}`,
      identity: localIdentity,
      label: localName,
      isLocal: true,
      hasVideo: Boolean(localTrack),
      track: localTrack,
      trackSid: localVideoPub?.trackSid || localTrack?.sid || '',
    })

    room.remoteParticipants.forEach((participant) => {
      if (!isVisibleForInvite(participant.identity)) return

      const videoPub = getVideoPublication(participant)
      const remoteTrack = videoPub?.track || null

      tiles.push({
        id: `remote-${participant.identity}`,
        identity: participant.identity,
        label: getMappedDisplayName(participant.identity) || getDisplayName(participant),
        isLocal: false,
        hasVideo: Boolean(remoteTrack),
        track: remoteTrack,
        trackSid: videoPub?.trackSid || remoteTrack?.sid || '',
      })
    })

    setParticipantTiles(tiles)
    setSelectedTileId((prev) => (tiles.some((t) => t.id === prev) ? prev : tiles[0]?.id || ''))
  }

  function attachAudioTrack(track, sid) {
    if (!hiddenAudioRef.current || !track || track.kind !== Track.Kind.Audio) return

    const existing = hiddenAudioRef.current.querySelector(`[data-track-sid="${sid}"]`)
    if (existing) return

    const audioEl = track.attach()
    audioEl.className = 'hidden-audio'
    audioEl.dataset.trackSid = sid
    audioEl.volume = speakerVolume / 100
    hiddenAudioRef.current.appendChild(audioEl)
  }

  function removeAttachedTrackElement(sid) {
    if (!sid || !hiddenAudioRef.current) return
    hiddenAudioRef.current.querySelectorAll(`[data-track-sid="${sid}"]`).forEach((el) => el.remove())
  }

  async function loginAdmin() {
    setAdminError('')
    try {
      const res = await fetch(`${apiBaseUrl}/admin/auth-check`, {
        method: 'GET',
        headers: { Authorization: adminAuthHeader() },
      })
      const body = await res.json()
      if (!res.ok || !body.ok) throw new Error(body.detail || 'Ошибка входа')
      setAdminLoggedIn(true)
    } catch (err) {
      setAdminError(String(err.message || err))
      setAdminLoggedIn(false)
    }
  }

  async function refreshChatHistory() {
    if (!inviteData || inviteData.chat_enabled === false) return
    try {
      const res = await fetch(`${inviteData.api_base_url}/chat/history?room_name=${encodeURIComponent(inviteData.room_name)}`)
      const body = await res.json()
      if (res.ok && Array.isArray(body.messages)) {
        setChatMessages(body.messages)
      }
    } catch {}
  }

  async function joinRoomWithInvite() {
    if (!inviteData) return
    if (!displayNameInput.trim()) {
      setError('Введите ФИО перед подключением')
      return
    }

    setError('')
    setWarning('')
    setNoVideoWarning('')

    try {
      setStatus('Получаем токен...')
      const tokenRes = await fetch(`${inviteData.api_base_url}/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          room_name: inviteData.room_name,
          participant_id: inviteData.participant_id,
          group_map: inviteData.group_map,
          invite_id: inviteData.invite_id,
        }),
      })

      const tokenBody = await tokenRes.json()
      if (!tokenRes.ok || !tokenBody.token) throw new Error(tokenBody.detail || 'Не удалось получить токен')

      const room = new Room({ adaptiveStream: true, dynacast: true })
      roomRef.current = room

      const refreshFromRoom = () => rebuildParticipantTiles(room)

      room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
        const sid = publication.trackSid || track.sid || ''
        if (track.kind === Track.Kind.Video && !isVisibleForInvite(participant.identity)) {
          publication.setSubscribed(false)
          return
        }
        if (track.kind === Track.Kind.Audio) attachAudioTrack(track, sid)
        refreshFromRoom()
      })

      room.on(RoomEvent.TrackUnsubscribed, (track, publication) => {
        const sid = publication?.trackSid || track?.sid || ''
        removeAttachedTrackElement(sid)
        refreshFromRoom()
      })

      room.on(RoomEvent.ParticipantConnected, async (participant) => {
        participant.trackPublications.forEach((pub) => {
          if (pub.kind === Track.Kind.Video) pub.setSubscribed(isVisibleForInvite(participant.identity))
        })
        const ownName = displayNameInput.trim()
        if (ownName) {
          try {
            const data = new TextEncoder().encode(JSON.stringify({ type: 'display_name', name: ownName }))
            await room.localParticipant.publishData(data, { reliable: true })
          } catch {}
        }
        refreshFromRoom()
      })

      room.on(RoomEvent.ParticipantDisconnected, () => refreshFromRoom())
      room.on(RoomEvent.ParticipantAttributesChanged, () => refreshFromRoom())

      room.on(RoomEvent.DataReceived, (payload, participant) => {
        if (!participant) return
        try {
          const decoded = new TextDecoder().decode(payload)
          const message = JSON.parse(decoded)
          if (message?.type === 'display_name' && typeof message.name === 'string') {
            const normalized = message.name.trim()
            if (normalized) {
              rememberDisplayName(participant.identity, normalized)
              refreshFromRoom()
            }
          }
        } catch {}
      })

      room.on(RoomEvent.TrackPublished, (publication, participant) => {
        if (publication.kind === Track.Kind.Video) publication.setSubscribed(isVisibleForInvite(participant?.identity))
        refreshFromRoom()
      })

      room.on(RoomEvent.TrackUnpublished, () => refreshFromRoom())
      room.on(RoomEvent.LocalTrackPublished, () => refreshFromRoom())
      room.on(RoomEvent.LocalTrackUnpublished, () => refreshFromRoom())

      setStatus('Подключаемся к конференции...')
      await room.connect(inviteData.livekit_url, tokenBody.token)

      const enteredDisplayName = displayNameInput.trim()
      setDisplayName(enteredDisplayName)
      rememberDisplayName(room.localParticipant.identity, enteredDisplayName)

      try {
        await room.localParticipant.setAttributes({ display_name: enteredDisplayName, displayName: enteredDisplayName })
      } catch {}

      try {
        await room.localParticipant.setMetadata(JSON.stringify({ display_name: enteredDisplayName }))
      } catch {}

      try {
        const data = new TextEncoder().encode(JSON.stringify({ type: 'display_name', name: enteredDisplayName }))
        await room.localParticipant.publishData(data, { reliable: true })
      } catch {}

      try {
        const metadata = JSON.parse(room.localParticipant.metadata || '{}')
        visibleIdsRef.current = metadata.visible_video_participants || []
      } catch {
        visibleIdsRef.current = []
      }

      room.remoteParticipants.forEach((participant) => {
        participant.trackPublications.forEach((pub) => {
          if (pub.kind === Track.Kind.Video) pub.setSubscribed(isVisibleForInvite(participant.identity))
          if (pub.kind === Track.Kind.Audio && pub.isSubscribed && pub.track) {
            const sid = pub.trackSid || pub.track.sid || ''
            attachAudioTrack(pub.track, sid)
          }
        })
      })

      setConnected(true)
      setStatus('Подключено')
      rebuildParticipantTiles(room)

      if (inviteData.chat_enabled !== false) {
        await refreshChatHistory()
        chatPollRef.current = setInterval(refreshChatHistory, 2500)
      }

      setTimeout(() => {
        const hasAnyVideo = room.localParticipant.videoTrackPublications.size > 0 ||
          Array.from(room.remoteParticipants.values()).some(p => Boolean(getVideoPublication(p)?.track))
        if (!hasAnyVideo) {
          setNoVideoWarning('Видео пока не отображается. Проверьте HTTPS/разрешения камеры.')
        }
      }, 6000)

      const mediaSupported = Boolean(navigator?.mediaDevices?.getUserMedia)
      if (mediaSupported) {
        try {
          await room.localParticipant.setMicrophoneEnabled(true)
          await room.localParticipant.setCameraEnabled(true)
          setMicEnabled(true)
          setCameraEnabled(true)
        } catch (publishErr) {
          setWarning(`Не удалось включить камеру/микрофон: ${String(publishErr?.message || publishErr)}`)
        }
      } else {
        setWarning('getUserMedia не поддерживается')
      }
    } catch (err) {
      if (roomRef.current) {
        roomRef.current.disconnect()
        roomRef.current = null
      }
      if (chatPollRef.current) {
        clearInterval(chatPollRef.current)
        chatPollRef.current = null
      }
      setError(String(err.message || err))
      setStatus('Ошибка подключения')
    }
  }

  async function leaveRoom() {
    const room = roomRef.current
    if (room) {
      room.disconnect()
      roomRef.current = null
    }
    if (chatPollRef.current) {
      clearInterval(chatPollRef.current)
      chatPollRef.current = null
    }
    hiddenAudioRef.current && (hiddenAudioRef.current.innerHTML = '')

    setConnected(false)
    setStatus('Отключено')
    setError('')
    setWarning('')
    setChatMessages([])
    setPersonalMessages([])
    setNoVideoWarning('')
    setParticipantTiles([])
    setSelectedTileId('')
  }

  async function toggleMic() {
    const room = roomRef.current
    if (!room) return
    const next = !micEnabled
    await room.localParticipant.setMicrophoneEnabled(next)
    setMicEnabled(next)
  }

  async function toggleCamera() {
    const room = roomRef.current
    if (!room) return
    const next = !cameraEnabled
    await room.localParticipant.setCameraEnabled(next)
    setCameraEnabled(next)
    setTimeout(() => rebuildParticipantTiles(room), 200)
  }

  async function sendChatMessage() {
    if (!inviteData || !chatInput.trim()) return

    const text = chatInput.trim()
    const senderName = displayName || displayNameInput || inviteData.participant_id || 'You'

    if (activeChatTab === 'personal') {
      setPersonalMessages((prev) => [...prev, { sender: senderName, text }])
      setChatInput('')
      return
    }

    try {
      const res = await fetch(`${inviteData.api_base_url}/chat/post`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          room_name: inviteData.room_name,
          invite_id: inviteData.invite_id,
          sender_name: senderName,
          text,
        }),
      })
      if (!res.ok) {
        const body = await res.json()
        throw new Error(body.detail || 'Ошибка отправки')
      }
      setChatInput('')
      await refreshChatHistory()
    } catch (err) {
      setWarning(String(err.message || err))
    }
  }

  async function copyInviteToClipboard() {
    if (!generatedInvite) return
    setCopyStatus('')
    try {
      await navigator.clipboard.writeText(generatedInvite)
      setCopyStatus('Ссылка скопирована')
    } catch {
      setCopyStatus('Не удалось скопировать автоматически. Скопируйте вручную.')
    }
  }

  async function generateInvite() {
    setAdminError('')
    setGeneratedInvite('')
    setCopyStatus('')

    try {
      let allParticipants = allList.split(',').map(x => x.trim()).filter(Boolean)

      const selfId = participantId.trim()
      allParticipants = allParticipants.filter(id => id !== selfId)

      const payload = {
        participant_id: participantId,
        room_name: roomName,
        livekit_url: serverUrl,
        api_base_url: apiBaseUrl,
        conference_topic: conferenceTopic,
        mode,
        chat_enabled: chatEnabled,
        unique_link: uniqueLink,
        allow_video_participants: allowList.split(',').map(x => x.trim()).filter(Boolean),
        deny_video_participants: denyList.split(',').map(x => x.trim()).filter(Boolean),
        all_video_participants: allParticipants,
      }

      const res = await fetch(`${apiBaseUrl}/admin/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: adminAuthHeader() },
        body: JSON.stringify(payload),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.detail || 'Не удалось создать ссылку')
      setGeneratedInvite(body.invite_url)
    } catch (err) {
      setAdminError(String(err.message || err))
    }
  }

  return (
    <>
      <div className="page">
        {!inviteData && (
          <div className="theme-switcher">
            <button className={theme === 'light' ? 'active' : ''} onClick={() => setTheme('light')}>Светлая</button>
            <button className={theme === 'gray' ? 'active' : ''} onClick={() => setTheme('gray')}>Серая</button>
            <button className={theme === 'dark' ? 'active' : ''} onClick={() => setTheme('dark')}>Тёмная</button>
          </div>
        )}

        {inviteData ? (
          <>
            <div className="hero"><h1>{inviteData.conference_topic || 'Конференция'}</h1></div>

            {!connected ? (
              <div className="panel compact prejoin">
                <h2>{inviteData.conference_topic || 'Конференция'}</h2>
                <label>Представьтесь (ФИО)</label>
                <input value={displayNameInput} onChange={(e) => setDisplayNameInput(e.target.value)} placeholder="Иванов Иван Иванович" />
                <div className="actions">
                  <button onClick={joinRoomWithInvite}>Войти в конференцию</button>
                </div>
                {status && <p className="muted">Статус: {status}</p>}
                {error && <p className="error">Ошибка: {error}</p>}
                {warning && <p className="warning">{warning}</p>}
              </div>
            ) : (
              <div className="meeting-ui">
                <header className="meeting-header">
                  <div className="meeting-header-left">
                    <span className="cube-icon" aria-hidden="true">Cube</span>
                    <h2>{inviteData.conference_topic || 'Конференция'}</h2>
                    <span className="meeting-timer">{callDurationLabel}</span>
                  </div>
                  <div className="meeting-header-right">
                    <div className="meeting-search" aria-label="Search message">
                      <span aria-hidden="true">Search</span>
                      <input type="text" placeholder="Search message..." />
                    </div>
                    <div className="meeting-avatar" title={displayName || inviteData.participant_id}>{(displayName || inviteData.participant_id).slice(0, 2).toUpperCase()}</div>
                  </div>
                </header>

                <div className="participant-strip-wrap">
                  <div className="participant-strip-label">Участники</div>
                  <div className="participant-strip">
                    {participantTiles.map((tile) => (
                      <button
                        key={tile.id}
                        className={`participant-tile ${tile.id === selectedTile?.id ? 'active' : ''}`}
                        onClick={() => setSelectedTileId(tile.id)}
                        type="button"
                      >
                        <div className="thumb-frame">
                          {tile.hasVideo ? (
                            <TrackVideo track={tile.track} className="thumb-video-element" />
                          ) : (
                            <span className="thumb-fallback-name">{tile.label}</span>
                          )}
                        </div>
                        <span>{tile.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="meeting-main-grid">
                  <section className="meeting-stage">
                    <div className="stage-title-row">
                      <h3>{selectedTile?.label || 'Главный поток'}</h3>
                      <span className="badge">Участников: {participantTiles.length}</span>
                    </div>

                    <div className="hero-video-grid single-view">
                      {selectedTile?.hasVideo ? (
                        <TrackVideo track={selectedTile.track} className="hero-video-element" />
                      ) : (
                        <div className="hero-fallback-name">{selectedTile?.label || 'Нет выбранного участника'}</div>
                      )}
                    </div>

                    <div className="meeting-controls">
                      <button onClick={toggleMic} className={`control-btn ${!micEnabled ? 'danger' : ''}`}>{micEnabled ? 'Mic' : 'Mic Off'}</button>
                      <button onClick={toggleCamera} className={`control-btn ${!cameraEnabled ? 'danger' : ''}`}>{cameraEnabled ? 'Camera' : 'Camera Off'}</button>
                      <button className="control-btn">Screen</button>
                      <button className="control-btn">More</button>
                      <button className="control-btn">Smile</button>
                      <button onClick={leaveRoom} className="leave-meet-btn">Leave Meet</button>
                    </div>

                    {noVideoWarning && <p className="warning">{noVideoWarning}</p>}
                  </section>

                  {inviteData.chat_enabled !== false && (
                    <aside className="meeting-chat-sidebar">
                      <div className="chat-tabs modern">
                        <button type="button" onClick={() => setActiveChatTab('group')} className={`tab ${activeChatTab === 'group' ? 'active' : ''}`}>Group</button>
                        <button type="button" onClick={() => setActiveChatTab('personal')} className={`tab ${activeChatTab === 'personal' ? 'active' : ''}`}>Personal</button>
                      </div>

                      <div ref={chatScrollRef} className="chat-thread">
                        {displayedMessages.map((m, idx) => {
                          const senderLabel = (m.sender || 'Участник').trim() || 'Участник'
                          return (
                            <div key={`${activeChatTab}-${idx}-${m.sender}-${m.text}`} className="chat-row-line">
                              <span className="chat-row-sender">{senderLabel}: </span>
                              <span className="chat-row-text">{m.text}</span>
                            </div>
                          )
                        })}
                      </div>

                      <div className="chat-composer">
                        <input
                          value={chatInput}
                          onChange={(e) => setChatInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                              e.preventDefault()
                              sendChatMessage()
                            }
                          }}
                          placeholder="Write a message..."
                        />
                      </div>
                    </aside>
                  )}
                </div>

                <div ref={hiddenAudioRef} className="hidden-audio-host" />
              </div>
            )}
          </>
        ) : (
          <>
            <div className="hero"><h1>Конференция</h1><p>Панель администратора</p></div>

            {!adminLoggedIn ? (
              <div className="panel compact">
                <h2>Вход администратора</h2>
                <label>Имя администратора</label>
                <input value={adminAuth.login} onChange={(e) => setAdminAuth((s) => ({ ...s, login: e.target.value }))} />
                <label>Пароль</label>
                <input type="password" value={adminAuth.password} onChange={(e) => setAdminAuth((s) => ({ ...s, password: e.target.value }))} />
                <button onClick={loginAdmin}>Войти</button>
                {adminError && <p className="error">{adminError}</p>}
              </div>
            ) : (
              <div className="panel">
                <h2>Настройки подключения</h2>
                <label>Тема конференции</label>
                <input value={conferenceTopic} onChange={(e) => setConferenceTopic(e.target.value)} />
                <label>LiveKit URL</label>
                <input value={serverUrl} onChange={(e) => setServerUrl(e.target.value)} />
                <label>API URL</label>
                <input value={apiBaseUrl} onChange={(e) => setApiBaseUrl(e.target.value)} />
                <label>Комната</label>
                <input value={roomName} onChange={(e) => setRoomName(e.target.value)} />
                <label>ID участника</label>
                <input value={participantId} onChange={(e) => setParticipantId(e.target.value)} />
                <label>Режим доступа</label>
                <select value={mode} onChange={(e) => setMode(e.target.value)}>
                  <option value="deny_list">Видит всех, кроме списка</option>
                  <option value="allow_list">Видит только список</option>
                </select>
                <label className="inline-check"><input type="checkbox" checked={chatEnabled} onChange={(e) => setChatEnabled(e.target.checked)} /> Общий чат включен</label>
                <label className="inline-check"><input type="checkbox" checked={uniqueLink} onChange={(e) => setUniqueLink(e.target.checked)} /> Выдача уникальных ссылок (одна ссылка = один вход)</label>
                <label>Все ID участников (через запятую)</label>
                <input value={allList} onChange={(e) => setAllList(e.target.value)} placeholder="Можно писать полный список включая себя — фронт сам удалит" />
                <label>Список "разрешить" (через запятую)</label>
                <input value={allowList} onChange={(e) => setAllowList(e.target.value)} placeholder="Напр.: P2,P3" />
                <label>Список "запретить" (через запятую)</label>
                <input value={denyList} onChange={(e) => setDenyList(e.target.value)} placeholder="Напр.: P6" />

                <button onClick={generateInvite}>Создать личную ссылку</button>
                {adminError && <p className="error">{adminError}</p>}
                {generatedInvite && (
                  <>
                    <div className="invite-row">
                      <textarea rows={3} readOnly value={generatedInvite} />
                      <button className="secondary" onClick={copyInviteToClipboard}>Копировать</button>
                    </div>
                    {copyStatus && <p className="muted">{copyStatus}</p>}
                  </>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </>
  )
}

export default App
