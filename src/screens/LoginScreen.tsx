/**
 * Login Screen — with persistent session restore
 */
import React, {useEffect, useState} from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {createClient, type MattermostClient} from '../api/client';
import {persistentStorage, STORAGE_KEYS} from '../api/persistent-storage';
import {setCurrentUserId, requestNotificationPermission} from '../api/notifications';
import {theme, changeOpacity} from '../theme/utils';

interface Props {
  onLogin: (client: MattermostClient) => void;
}

export default function LoginScreen({onLogin}: Props) {
  const [serverUrl, setServerUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<'server' | 'login'>('server');
  const [autoLoginAttempted, setAutoLoginAttempted] = useState(false);

  // Restore saved server URL + try auto-login on mount
  useEffect(() => {
    (async () => {
      const savedUrl = await persistentStorage.getString(STORAGE_KEYS.SERVER_URL);
      const savedToken = await persistentStorage.getString(STORAGE_KEYS.AUTH_TOKEN);

      if (savedUrl) {
        setServerUrl(savedUrl);
      }

      // Try auto-login with saved token
      if (savedUrl && savedToken && !autoLoginAttempted) {
        setAutoLoginAttempted(true);
        setLoading(true);
        try {
          const client = createClient(savedUrl);
          client.setToken(savedToken);
          // Verify token is still valid
          const me = await client.getMe();
          if (me && me.id) {
            // Token works — connect WS and enter app
            setCurrentUserId(me.id);
            requestNotificationPermission();
            client.connectWebSocket().catch(() => {});
            onLogin(client);
            return;
          }
        } catch {
          // Token expired — clear it, show login
          await persistentStorage.delete(STORAGE_KEYS.AUTH_TOKEN);
          if (savedUrl) setStep('login'); // Skip server step, go to login
        } finally {
          setLoading(false);
        }
      }
    })();
  }, []);

  const handleServerSubmit = async () => {
    const url = serverUrl.trim().replace(/\/+$/, '');
    if (!url) {
      Alert.alert('Error', 'Please enter a server URL');
      return;
    }

    setLoading(true);
    try {
      // Save server URL
      await persistentStorage.setString(STORAGE_KEYS.SERVER_URL, url);
      const client = createClient(url);
      // Verify server is reachable
      const info = await client.ping();
      if (info) {
        setStep('login');
      }
    } catch (error: any) {
      Alert.alert('Connection Error', `Cannot reach server: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async () => {
    if (!username.trim() || !password.trim()) {
      Alert.alert('Error', 'Please enter username and password');
      return;
    }

    setLoading(true);
    try {
      const url = serverUrl.trim().replace(/\/+$/, '');
      const client = createClient(url);
      const user = await client.login(username.trim(), password);
      if (user) {
        // Persist session
        await persistentStorage.setString(STORAGE_KEYS.SERVER_URL, url);
        await persistentStorage.setString(STORAGE_KEYS.AUTH_TOKEN, client.getToken() || '');
        await persistentStorage.setString(STORAGE_KEYS.USER_ID, user.id);
        await persistentStorage.setString(STORAGE_KEYS.USERNAME, user.username);

        // Connect WebSocket for real-time
        requestNotificationPermission();
        client.connectWebSocket().catch((wsErr) => {
          console.log('[Login] WebSocket connection failed:', wsErr);
        });
        onLogin(client);
      }
    } catch (error: any) {
      Alert.alert('Login Failed', error.message || 'Invalid credentials');
    } finally {
      setLoading(false);
    }
  };

  // Loading overlay for auto-login
  if (loading && autoLoginAttempted && !username) {
    return (
      <View style={styles.container}>
        <View style={styles.autoLoginContainer}>
          <ActivityIndicator size="large" color="theme.buttonBg" />
          <Text style={styles.autoLoginText}>Restoring session...</Text>
        </View>
      </View>
    );
  }

  if (step === 'server') {
    return (
      <KeyboardAvoidingView
        style={styles.container}
        behavior={'height'}>
        <View style={styles.header}>
          <Text style={styles.title}>Mattermost</Text>
          <Text style={styles.subtitle}>Connect to your server</Text>
        </View>

        <View style={styles.form}>
          <Text style={styles.label}>Server URL</Text>
          <TextInput
            style={styles.input}
            placeholder="https://your-server.com"
            placeholderTextColor="#6b7ca0"
            value={serverUrl}
            onChangeText={setServerUrl}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            returnKeyType="go"
            onSubmitEditing={handleServerSubmit}
          />
          <TouchableOpacity
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={handleServerSubmit}
            disabled={loading}>
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Connect</Text>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={'height'}>
      <View style={styles.header}>
        <Text style={styles.title}>Sign In</Text>
        <Text style={styles.subtitle}>{serverUrl}</Text>
      </View>

      <View style={styles.form}>
        <Text style={styles.label}>Username or Email</Text>
        <TextInput
          style={styles.input}
          placeholder="username"
          placeholderTextColor="#6b7ca0"
          value={username}
          onChangeText={setUsername}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="next"
        />

        <Text style={styles.label}>Password</Text>
        <TextInput
          style={styles.input}
          placeholder="password"
          placeholderTextColor="#6b7ca0"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          returnKeyType="go"
          onSubmitEditing={handleLogin}
        />

        <TouchableOpacity
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={handleLogin}
          disabled={loading}>
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Sign In</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.backButton}
          onPress={() => setStep('server')}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.sidebarBg,
  },
  autoLoginContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  autoLoginText: {
    color: changeOpacity(theme.sidebarText, 0.7),
    fontSize: 14,
    marginTop: 16,
  },
  header: {
    paddingTop: 80,
    paddingBottom: 40,
    alignItems: 'center',
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#ffffff',
  },
  subtitle: {
    fontSize: 14,
    color: changeOpacity(theme.sidebarText, 0.7),
    marginTop: 8,
  },
  form: {
    paddingHorizontal: 32,
  },
  label: {
    color: changeOpacity(theme.sidebarText, 0.7),
    fontSize: 13,
    marginBottom: 6,
    marginTop: 16,
    fontWeight: '500',
  },
  input: {
    backgroundColor: changeOpacity(theme.sidebarText, 0.1),
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: '#ffffff',
    borderWidth: 1,
    borderColor: changeOpacity(theme.sidebarText, 0.2),
  },
  button: {
    backgroundColor: theme.buttonBg,
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 24,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  backButton: {
    alignItems: 'center',
    marginTop: 16,
    paddingVertical: 8,
  },
  backText: {
    color: changeOpacity(theme.sidebarText, 0.7),
    fontSize: 14,
  },
});
