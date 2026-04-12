/**
 * @format
 */

import { AppRegistry } from 'react-native';
import App from './App';
import TrackPlayer from 'react-native-track-player';
import { PlaybackService } from './src/services/playbackService';

// Register the app component — must be the hardcoded string that matches app.json.
AppRegistry.registerComponent('FocusPod', () => App);

// Register the background audio service for react-native-track-player.
TrackPlayer.registerPlaybackService(() => PlaybackService);
