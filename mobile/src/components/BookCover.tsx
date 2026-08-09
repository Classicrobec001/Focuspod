import React, { useState } from 'react';
import { View, Image, StyleSheet, Text } from 'react-native';
import { Colors } from '../constants/colors';
import { Layout } from '../constants/layout';

interface BookCoverProps {
  uri?: string;
  title?: string;
  size?: number;
}

export default function BookCover({ uri, title, size = 180 }: BookCoverProps) {
  const [error, setError] = useState(false);
  const initials = title
    ? title
        .split(' ')
        .slice(0, 2)
        .map(w => w[0])
        .join('')
        .toUpperCase()
    : '?';

  return (
    <View style={[styles.container, { width: size, height: size, borderRadius: size * 0.08 }]}>
      {uri && !error ? (
        <Image
          source={{ uri }}
          style={[styles.image, { width: size, height: size, borderRadius: size * 0.08 }]}
          onError={() => setError(true)}
          resizeMode="cover"
        />
      ) : (
        <View style={[styles.placeholder, { width: size, height: size, borderRadius: size * 0.08 }]}>
          <Text style={[styles.initials, { fontSize: size * 0.28 }]}>{initials}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
    backgroundColor: Colors.surfaceElevated,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.6,
    shadowRadius: 16,
    elevation: 16,
  },
  image: {
    backgroundColor: Colors.surfaceElevated,
  },
  placeholder: {
    backgroundColor: Colors.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  initials: {
    color: Colors.textMuted,
    fontWeight: '200',
    letterSpacing: 2,
  },
});
