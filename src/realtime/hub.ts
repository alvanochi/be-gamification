import type { Server as HttpServer } from 'http';
import { Server as IOServer } from 'socket.io';

/**
 * Pusat siaran realtime.
 *
 * Dipakai untuk hal-hal yang harus terlihat serentak di banyak perangkat:
 * daftar anggota kelompok, hasil voting ketua, pengumuman panitia, dan
 * klasemen. SRS 5.3 mensyaratkan pembaruan terlihat di bawah 2 detik — polling
 * tidak cukup untuk itu.
 *
 * Modul ini sengaja menyimpan instance-nya sendiri sehingga service mana pun
 * bisa memanggil `broadcast()` tanpa harus menerima `io` lewat parameter.
 */
let io: IOServer | null = null;

export const initRealtime = (server: HttpServer, corsOrigin: string | string[]) => {
  io = new IOServer(server, {
    cors: { origin: corsOrigin, credentials: true },
    // Polling tetap diizinkan sebagai jaring pengaman bila proxy di depan
    // aplikasi belum meneruskan koneksi upgrade.
    transports: ['websocket', 'polling'],
  });

  io.on('connection', socket => {
    // Peserta bergabung ke kanal kelompoknya agar pembaruan anggota dan voting
    // hanya sampai ke kelompok yang bersangkutan.
    socket.on('group:join', (groupId: unknown) => {
      if (typeof groupId === 'string' && groupId) socket.join(`group:${groupId}`);
    });

    socket.on('group:leave', (groupId: unknown) => {
      if (typeof groupId === 'string' && groupId) socket.leave(`group:${groupId}`);
    });
  });

  return io;
};

/** Siaran ke seluruh perangkat yang terhubung. */
export const broadcast = (event: string, payload: unknown) => {
  io?.emit(event, payload);
};

/** Siaran hanya ke anggota satu kelompok. */
export const broadcastToGroup = (groupId: string, event: string, payload: unknown) => {
  io?.to(`group:${groupId}`).emit(event, payload);
};

export const isRealtimeReady = () => io !== null;
