import React, { useRef, useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  Dimensions, Alert, ActivityIndicator,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle, Line } from 'react-native-svg';
import client from '../api/client';
import ScoreRing from '../components/ScoreRing';

const { width: SW, height: SH } = Dimensions.get('window');
const CAM_H = SH * 0.44;

const MIN_CONF = 0.3;

const SKELETON = [
  [0,1],[0,2],[1,3],[2,4],
  [5,6],
  [5,7],[7,9],[6,8],[8,10],
  [5,11],[6,12],[11,12],
  [11,13],[13,15],[12,14],[14,16],
];

const KP = { NOSE:0, L_EYE:1, R_EYE:2, L_EAR:3, R_EAR:4, L_SH:5, R_SH:6 };

const MANUAL = [
  { label: 'Düzgün', score: 85, status: 'good',    neck_angle: 8,  head_tilt: 3,  shoulder_tilt: 3,  tension: 15, center_offset: 5,  color: '#22c55e' },
  { label: 'Orta',   score: 60, status: 'warning',  neck_angle: 22, head_tilt: 9,  shoulder_tilt: 9,  tension: 42, center_offset: 15, color: '#f59e0b' },
  { label: 'Kötü',   score: 28, status: 'bad',      neck_angle: 38, head_tilt: 16, shoulder_tilt: 16, tension: 72, center_offset: 26, color: '#ef4444' },
];

export default function PostureScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const [facing, setFacing]     = useState('front');
  const [aiMode, setAiMode]     = useState('loading');
  const [keypoints, setKeypoints] = useState([]);
  const [result, setResult]     = useState(null);
  const [isTracking, setIsTracking] = useState(false);
  const [sessionSec, setSessionSec] = useState(0);
  const [recordCount, setRecordCount] = useState(0);

  const cameraRef    = useRef(null);
  const sessionIdRef = useRef(null);
  const timerRef     = useRef(null);
  const detectorRef  = useRef(null);
  const busyRef      = useRef(false);
  const facingRef    = useRef('front');
  // Modülleri bir kez yükle, her frame'de tekrar import etme
  const imgMgrRef    = useRef(null);
  const jpegRef      = useRef(null);
  const tfRef        = useRef(null);

  useEffect(() => { facingRef.current = facing; }, [facing]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (typeof global.window === 'undefined') global.window = global;
        if (!global.window.fetch) global.window.fetch = global.fetch;
        if (!global.document) global.document = { createElement: () => ({ getContext: () => null }) };
        if (!global.navigator) global.navigator = { userAgent: 'ReactNative' };

        const tf = await import('@tensorflow/tfjs');
        await import('@tensorflow/tfjs-backend-cpu');
        await tf.setBackend('cpu');
        await tf.ready();

        const poseDetection = await import('@tensorflow-models/pose-detection');
        const detector = await poseDetection.createDetector(
          poseDetection.SupportedModels.MoveNet,
          { modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING }
        );
        if (!cancelled) { detectorRef.current = detector; setAiMode('ready'); }
      } catch (e) {
        console.warn('TF.js yüklenemedi:', e.message);
        if (!cancelled) setAiMode('failed');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const analyzeFrame = useCallback(async () => {
    if (busyRef.current || !cameraRef.current || !detectorRef.current) return;
    busyRef.current = true;
    let tensor = null;
    try {
      // Modülleri ilk kullanımda yükle, sonra cache'den al
      if (!imgMgrRef.current) imgMgrRef.current = await import('expo-image-manipulator');
      if (!jpegRef.current)   jpegRef.current   = await import('jpeg-js');
      if (!tfRef.current)     tfRef.current     = await import('@tensorflow/tfjs');

      const photo = await cameraRef.current.takePictureAsync({ base64: false, quality: 0.4 });

      // iOS ham görüntü landscape saklar (rawW>rawH) — portrait boyutlara çevir
      const rawW = photo.width, rawH = photo.height;
      const effW = rawW > rawH ? rawH : rawW;
      const effH = rawW > rawH ? rawW : rawH;

      // Kamera görünümü oranına (SW:CAM_H) kırp — skeleton hizalaması için kritik
      const displayAR = SW / CAM_H;
      let cropX = 0, cropY = 0, cropW = effW, cropH = effH;
      if (effW / effH > displayAR) {
        cropW = Math.round(effH * displayAR);
        cropX = Math.round((effW - cropW) / 2);
      } else {
        cropH = Math.round(effW / displayAR);
        cropY = Math.round((effH - cropH) / 2);
      }

      const resized = await imgMgrRef.current.manipulateAsync(
        photo.uri,
        [
          { crop: { originX: cropX, originY: cropY, width: cropW, height: cropH } },
          { resize: { width: 192, height: 192 } },
        ],
        { format: 'jpeg' },  // base64 yok — fetch ile oku (atob'dan güvenilir)
      );

      // fetch ile ikili veri oku (atob RN'de büyük görüntülerde sorun çıkarabiliyor)
      const resp = await fetch(resized.uri);
      const buf  = await resp.arrayBuffer();
      const raw  = jpegRef.current.decode(buf, { useTArray: true });

      const rgb = new Uint8Array(192 * 192 * 3);
      for (let i = 0, j = 0; i < raw.data.length; i += 4, j += 3) {
        rgb[j] = raw.data[i]; rgb[j+1] = raw.data[i+1]; rgb[j+2] = raw.data[i+2];
      }

      tensor = tfRef.current.tensor3d(rgb, [192, 192, 3], 'int32');
      const poses = await detectorRef.current.estimatePoses(tensor);

      if (poses.length > 0) {
        const kps = poses[0].keypoints;
        setKeypoints(kps);
        const analysis = computePosture(kps);
        if (analysis) {
          setResult(analysis);
          if (isTracking && sessionIdRef.current) sendRecord(analysis);
        }
      } else {
        setKeypoints([]);  // kişi yoksa eski skeleton'ı temizle
      }
    } catch (e) {
      console.warn('analyzeFrame hatası:', e.message);
    } finally {
      if (tensor) tensor.dispose();  // bellek sızıntısı önle — mutlaka çalışmalı
      busyRef.current = false;
    }
  }, [isTracking]);

  useEffect(() => {
    if (aiMode !== 'ready') return;
    const id = setInterval(analyzeFrame, 1000);
    return () => clearInterval(id);
  }, [aiMode, analyzeFrame]);

  const sendRecord = async (r) => {
    if (!sessionIdRef.current) return;
    try {
      await client.post('/posture/record', {
        session_id: sessionIdRef.current,
        records: [{
          score: r.score, neck_angle: r.neck_angle, head_tilt: r.head_tilt,
          shoulder_tilt: r.shoulder_tilt, tension: r.tension,
          center_offset: r.center_offset, status: r.status,
        }],
      });
      setRecordCount(c => c + 1);
    } catch { }
  };

  const sendManual = (rating) => {
    setResult({ ...rating });
    if (isTracking && sessionIdRef.current) sendRecord(rating);
  };

  const startSession = async () => {
    try {
      const res = await client.post('/posture/session/start');
      const id  = res.data?.session?.id ?? res.data?.id ?? res.data?.sessionId;
      if (!id) throw new Error('Session ID alınamadı');
      sessionIdRef.current = id;
      setIsTracking(true);
      setSessionSec(0);
      setRecordCount(0);
      timerRef.current = setInterval(() => setSessionSec(s => s + 1), 1000);
    } catch (e) {
      Alert.alert('Hata', 'Oturum başlatılamadı:\n' + (e.response?.data?.message || e.message));
    }
  };

  const endSession = async () => {
    clearInterval(timerRef.current);
    setIsTracking(false);
    const sid = sessionIdRef.current;
    sessionIdRef.current = null;
    if (sid) {
      try { await client.post(`/posture/session/${sid}/end`); } catch { }
      Alert.alert('Tamamlandı', `${fmt(sessionSec)} oturum bitti.\n${recordCount} analiz kaydedildi.`);
    }
    setSessionSec(0); setRecordCount(0); setResult(null); setKeypoints([]);
  };

  if (!permission) return <SafeAreaView style={s.safe}><ActivityIndicator color="#6366f1" style={{ marginTop: 60 }} /></SafeAreaView>;
  if (!permission.granted) {
    return (
      <SafeAreaView style={s.safe}><View style={s.center}>
        <Text style={s.permTitle}>Kamera İzni Gerekli</Text>
        <TouchableOpacity style={s.btn} onPress={requestPermission}><Text style={s.btnTxt}>İzin Ver</Text></TouchableOpacity>
      </View></SafeAreaView>
    );
  }

  const isFront = facing === 'front';

  return (
    <SafeAreaView style={s.safe}>
      <View style={[s.camBox, { height: CAM_H }]}>
        <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing={facing} />

        {aiMode === 'ready' && keypoints.length > 0 && (
          <Svg style={StyleSheet.absoluteFill} width={SW} height={CAM_H}>
            {SKELETON.map(([a, b]) => {
              const pa = kpScreen(keypoints[a], SW, CAM_H, isFront);
              const pb = kpScreen(keypoints[b], SW, CAM_H, isFront);
              if (!pa || !pb) return null;
              return (
                <Line
                  key={`l${a}-${b}`}
                  x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y}
                  stroke="#6366f1" strokeWidth={2.5} opacity={0.9}
                />
              );
            })}
            {keypoints.map((kp, i) => {
              const pt = kpScreen(kp, SW, CAM_H, isFront);
              if (!pt) return null;
              return (
                <Circle
                  key={`c${i}`}
                  cx={pt.x} cy={pt.y}
                  r={i <= 4 ? 5 : 4}
                  fill={i <= 4 ? '#a5b4fc' : '#818cf8'}
                  stroke="#fff" strokeWidth={1.5}
                />
              );
            })}
          </Svg>
        )}

        <TouchableOpacity style={s.flipBtn} onPress={() => setFacing(f => f === 'front' ? 'back' : 'front')}>
          <Text style={s.flipTxt}>🔄</Text>
        </TouchableOpacity>

        <View style={s.badge}>
          {aiMode === 'ready'   && <><View style={s.dotGreen}/><Text style={s.badgeTxt}>CANLI ANALİZ</Text></>}
          {aiMode === 'loading' && <><ActivityIndicator size="small" color="#fff"/><Text style={s.badgeTxt}>  AI Yükleniyor…</Text></>}
          {aiMode === 'failed'  && <Text style={s.badgeTxt}>Manuel Mod</Text>}
        </View>

        {isTracking && (
          <View style={s.recBadge}>
            <View style={s.dotRed}/>
            <Text style={s.recTxt}>REC {fmt(sessionSec)} · {recordCount} kayıt</Text>
          </View>
        )}
      </View>

      <View style={s.scoreRow}>
        <ScoreRing score={result?.score ?? 0} size={68} strokeWidth={6} />
        <View style={{ flex: 1 }}>
          <Text style={s.scoreName}>
            {result ? statusLabel(result.status) : 'Analiz bekleniyor…'}
          </Text>
          <Text style={s.scoreSub}>
            {result
              ? `Boyun ${result.neck_angle}° · Omuz ${result.shoulder_tilt}° · Gerginlik %${Math.round(result.tension)}`
              : aiMode === 'ready'
                ? 'Kameraya bakın, otomatik analiz başlıyor'
                : 'Oturum başlatın, aşağıdan değerlendirin'}
          </Text>
        </View>
      </View>

      {aiMode !== 'ready' && (
        <View style={s.block}>
          <Text style={s.blockLbl}>
            {aiMode === 'loading' ? 'AI yüklenirken manuel değerlendir:' : 'Duruşunuzu değerlendirin:'}
          </Text>
          <View style={s.manualRow}>
            {MANUAL.map(m => (
              <TouchableOpacity
                key={m.label}
                style={[s.manBtn, { borderColor: m.color }, result?.status === m.status && { backgroundColor: m.color + '22' }]}
                onPress={() => sendManual(m)}
              >
                <Text style={[s.manScore, { color: m.color }]}>{m.score}</Text>
                <Text style={[s.manLabel, { color: m.color }]}>{m.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}

      <View style={s.block}>
        {isTracking ? (
          <TouchableOpacity style={[s.btn, s.stopBtn]} onPress={endSession}>
            <Text style={s.btnTxt}>⏹  Oturumu Bitir ve Kaydet</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={s.btn} onPress={startSession}>
            <Text style={s.btnTxt}>▶  Oturum Başlat</Text>
          </TouchableOpacity>
        )}
      </View>

      <View style={s.infoBox}>
        <Text style={s.infoTxt}>
          {aiMode === 'ready'
            ? 'AI duruşunuzu otomatik analiz ediyor · Oturum başlatınca kayıtlar istatistiklere eklenir'
            : 'Oturum başlat · Duruşuna göre butona bas · Bitir · Geçmiş ve AI sekmelerini kontrol et'}
        </Text>
      </View>
    </SafeAreaView>
  );
}

function kpScreen(kp, sw, camH, isFront) {
  if (!kp || kp.score < MIN_CONF) return null;
  let x = (kp.x / 192) * sw;
  // Ön kamera preview mirror'landığı için X koordinatını ters çevir
  if (isFront) x = sw - x;
  return { x, y: (kp.y / 192) * camH };
}

function computePosture(kps) {
  const ls = kps[KP.L_SH], rs = kps[KP.R_SH];
  if (!ls || !rs || ls.score < MIN_CONF || rs.score < MIN_CONF) return null;

  const smx = (ls.x + rs.x) / 2, smy = (ls.y + rs.y) / 2;
  const shW = Math.abs(ls.x - rs.x) || 1;

  let neckAngle = 0;
  const le = kps[KP.L_EAR], re = kps[KP.R_EAR], no = kps[KP.NOSE];
  if (le?.score >= MIN_CONF && re?.score >= MIN_CONF) {
    const dx = (le.x + re.x) / 2 - smx, dy = smy - (le.y + re.y) / 2;
    neckAngle = Math.abs(Math.atan2(Math.abs(dx), Math.max(1, Math.abs(dy))) * 180 / Math.PI);
  } else if (no?.score >= MIN_CONF) {
    const dx = no.x - smx, dy = smy - no.y;
    neckAngle = Math.abs(Math.atan2(Math.abs(dx), Math.max(1, Math.abs(dy))) * 180 / Math.PI);
  }

  const headTilt     = (le?.score >= MIN_CONF && re?.score >= MIN_CONF)
    ? (Math.abs(le.y - re.y) / shW) * 100 : 0;
  const shoulderTilt = (Math.abs(ls.y - rs.y) / shW) * 100;
  const centerOffset = no?.score >= MIN_CONF ? (Math.abs(no.x - smx) / shW) * 100 : 0;
  const tension      = Math.min(100, neckAngle * 1.8 + shoulderTilt * 0.5);

  let score = 100;
  if (neckAngle > 12)    score -= Math.min(45, (neckAngle - 12) * 2.2);
  if (headTilt > 8)      score -= Math.min(20, (headTilt - 8) * 1.5);
  if (shoulderTilt > 6)  score -= Math.min(20, (shoulderTilt - 6) * 1.5);
  if (centerOffset > 15) score -= Math.min(15, (centerOffset - 15) * 0.8);
  score = Math.max(0, Math.round(score));

  return {
    score,
    neck_angle:    +neckAngle.toFixed(1),
    head_tilt:     +headTilt.toFixed(1),
    shoulder_tilt: +shoulderTilt.toFixed(1),
    tension:       +tension.toFixed(1),
    center_offset: +centerOffset.toFixed(1),
    status:        score >= 75 ? 'good' : score >= 50 ? 'warning' : 'bad',
  };
}

function statusLabel(s) {
  return s === 'good' ? 'Düzgün Duruş' : s === 'warning' ? 'Dikkat — Duruş Bozuluyor' : 'Kötü Duruş';
}
function fmt(s) { return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`; }

const s = StyleSheet.create({
  safe:      { flex: 1, backgroundColor: '#020617' },
  center:    { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  permTitle: { fontSize: 20, fontWeight: '800', color: '#e2e8f0', marginBottom: 24, textAlign: 'center' },
  camBox:    { backgroundColor: '#0f172a', overflow: 'hidden' },
  flipBtn:   { position: 'absolute', top: 12, right: 12, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 8, padding: 8 },
  flipTxt:   { fontSize: 18 },
  badge:     { position: 'absolute', top: 12, left: 12, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 5 },
  dotGreen:  { width: 7, height: 7, borderRadius: 4, backgroundColor: '#22c55e' },
  dotRed:    { width: 7, height: 7, borderRadius: 4, backgroundColor: '#ef4444' },
  badgeTxt:  { color: '#fff', fontSize: 11, fontWeight: '700', letterSpacing: 0.4 },
  recBadge:  { position: 'absolute', bottom: 10, left: 12, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 5 },
  recTxt:    { color: '#fff', fontSize: 11, fontWeight: '700' },
  scoreRow:  { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#0f172a', borderBottomWidth: 1, borderBottomColor: '#1e293b' },
  scoreName: { fontSize: 15, fontWeight: '700', color: '#e2e8f0' },
  scoreSub:  { fontSize: 11, color: '#64748b', marginTop: 4, lineHeight: 16 },
  block:     { paddingHorizontal: 16, paddingTop: 12 },
  blockLbl:  { fontSize: 12, fontWeight: '600', color: '#94a3b8', marginBottom: 8 },
  manualRow: { flexDirection: 'row', gap: 10 },
  manBtn:    { flex: 1, borderWidth: 2, borderRadius: 14, paddingVertical: 12, alignItems: 'center', gap: 2 },
  manScore:  { fontSize: 22, fontWeight: '800' },
  manLabel:  { fontSize: 12, fontWeight: '700' },
  btn:       { backgroundColor: '#6366f1', borderRadius: 14, paddingVertical: 15, alignItems: 'center' },
  stopBtn:   { backgroundColor: '#dc2626' },
  btnTxt:    { color: '#fff', fontWeight: '800', fontSize: 16 },
  infoBox:   { marginHorizontal: 16, marginTop: 12, backgroundColor: 'rgba(99,102,241,0.07)', borderRadius: 12, borderWidth: 1, borderColor: 'rgba(99,102,241,0.15)', padding: 12 },
  infoTxt:   { fontSize: 12, color: '#64748b', lineHeight: 18, textAlign: 'center' },
});
