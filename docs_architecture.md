# FocusPod System Architecture

## 1. Product Shape

FocusPod is a mobile app for distraction-free listening to public-domain audiobooks. The app combines three systems:

1. Audiobook playback  
2. Focus session control  
3. Distraction blocking  

Core principle: The user enters a session, selects duration, and stays in a controlled listening environment.

---

## 2. High-Level Architecture

### Layers
- **Presentation Layer**: UI, navigation, iPod-style interaction  
- **Application Layer**: Session logic, playback coordination, blocking rules  
- **Data Layer**: Metadata, downloads, playback progress  
- **Native Layer**: Audio background, Android blocking  

### External Services
- Content: Librivox / public domain  
- Backend: Firebase  

---

## 3. System Components

### A. Mobile App Client
- UI rendering  
- Audio playback  
- Session management  
- Local storage  
- Offline support  

---

### B. Audio Engine
Responsibilities:
- Stream + download audio  
- Resume playback  
- Chapter navigation  
- Background play  

States:
- idle, loading, playing, paused, buffering, completed, error  

---

### C. Focus Session Engine
Responsibilities:
- Start/end sessions  
- Track time  
- Lock UI  
- Coordinate blocking  

States:
- not_started, preparing, active, paused, completed, interrupted, cancelled  

---

### D. App Blocking (Android)
- Detect foreground apps  
- Redirect if blocked  
- Requires Accessibility + Usage access  

iOS: soft restriction only  

---

### E. Content System
- Fetch + normalize audiobook data  
- Cache metadata + audio  
- Enable offline playback  

---

### F. Local Storage
Stores:
- Playback progress  
- Downloads  
- Session state  
- Preferences  

---

### G. Analytics
Track:
- Session start/completion  
- Playback events  
- Downloads  
- Permission status  

---

## 4. System Flows

### Start Session
1. Select book  
2. Set duration  
3. Start session  
4. Begin playback  
5. Activate blocking  

### During Session
- Timer runs  
- Audio plays  
- Blocking enforced  

### End Session
- Timer ends  
- Playback stops  
- Blocking removed  
- Save session  

---

## 5. App Modules
- Library  
- Player  
- Focus  
- Blocking  
- Settings  
- Sync  

---

## 6. Data Models

### Book
- id, title, author, description  
- coverUrl, categories  
- chapters, duration  

### Chapter
- id, bookId, title  
- audioUrl, duration  

### PlaybackState
- bookId, chapterId  
- position, status  

### FocusSession
- id, duration  
- start/end time  
- status, blockedApps  

### UserPreferences
- theme, haptics  
- default session  
- blocked apps  

---

## 7. State Management

Stores:
- PlaybackStore  
- SessionStore  
- LibraryStore  
- DownloadStore  
- SettingsStore  
- PermissionStore  

---

## 8. Navigation

Screens:
- Library  
- Book Detail  
- Now Playing  
- Focus Setup  
- Active Session  
- Settings  

Rule: Restrict navigation during session  

---

## 9. Native Integration

### Android
- Foreground app detection  
- Blocking enforcement  
- Permission handling  

### iOS
- Audio background  
- Playback handling  

---

## 10. Error Handling
- Missing audio → retry  
- No network → fallback offline  
- Permission revoked → end session  
- App restart → restore state  

---

## 11. Performance
- Launch < 2s  
- Playback start < 1s  
- Smooth interaction  

---

## 12. Security & Privacy
- Minimal data collection  
- Clear permission usage  
- Local-first approach  

---

## 13. MVP Scope
Includes:
- Audio playback  
- Focus sessions  
- Android blocking  
- Offline support  

Excludes:
- Social features  
- Accounts  
- AI recommendations  

---

## 14. Build Order
1. Audio player  
2. Library  
3. Playback persistence  
4. Focus timer  
5. Session UI  
6. Blocking  
7. Downloads  
8. Content ingestion  
