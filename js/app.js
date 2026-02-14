/**
 * DAPOSIS - Student Portal Logic
 * Secure Implementation with Vanilla JS
 */

(function () {
    'use strict';

    // ==========================================
    // 0. KONFIGURASI & STATE (TERTUTUP)
    // ==========================================

    const CONFIG = Object.freeze({
        SUPABASE_URL: 'https://nndbuqskaokcoptttmpk.supabase.co',
        SUPABASE_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5uZGJ1cXNrYW9rY29wdHR0bXBrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA1NDYzMzQsImV4cCI6MjA4NjEyMjMzNH0.rqqf4gYeT0MYqZ-4nt_T8LtnQoOlS6dYQ7wXEKvh78Q',
        SESSION_KEY: 'siswa_session_secure',
        SESSION_DURATION: 6 * 60 * 60 * 1000, // 6 Jam
    });

    // Inisialisasi Supabase Client (Private Scope)
    const supabase = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY);

    // State Aplikasi (Private Scope)
    let appState = {
        currentUser: null,
        profile: null,
        parents: [],
        currentRoute: '#login'
    };

    // ==========================================
    // 1. GLOBAL ERROR HANDLING
    // ==========================================

    window.addEventListener('unhandledrejection', event => {
        console.error('Unhandled promise rejection:', event.reason);
        showToast('Terjadi kesalahan sistem (Network/Logic).', 'error');
    });

    window.addEventListener('error', event => {
        console.error('Global error:', event.error);
    });

    // ==========================================
    // 2. SESSION MANAGEMENT
    // ==========================================

    function getSession() {
        try {
            const raw = localStorage.getItem(CONFIG.SESSION_KEY);
            if (!raw) return null;

            const session = JSON.parse(raw);

            // Validasi Struktur Session
            if (!session.id_siswa || !session.expires_at) {
                throw new Error('Struktur sesi tidak valid');
            }

            // Cek Expired
            if (Date.now() > session.expires_at) {
                throw new Error('Sesi berakhir');
            }

            return session;
        } catch (e) {
            console.warn('Session invalid:', e.message);
            destroySession();
            if (e.message === 'Sesi berakhir') {
                showToast('Sesi Anda telah berakhir. Silakan login kembali.', 'warning');
            }
            return null;
        }
    }

    function createSession(data) {
        const session = {
            id_siswa: data.id_siswa,
            nama: data.nama_lengkap,
            login_at: Date.now(),
            expires_at: Date.now() + CONFIG.SESSION_DURATION
        };
        localStorage.setItem(CONFIG.SESSION_KEY, JSON.stringify(session));
        return session;
    }

    function destroySession() {
        localStorage.removeItem(CONFIG.SESSION_KEY);
        appState.currentUser = null;
        appState.profile = null;
        appState.parents = [];
    }

    // ==========================================
    // 3. ROUTING & NAVIGASI
    // ==========================================

    function initRouter() {
        window.addEventListener('hashchange', handleRoute);
        handleRoute(); // Handle load awal
    }

    async function handleRoute() {
        const hash = window.location.hash || '#login';
        appState.currentRoute = hash;

        const session = getSession();

        // Guard: Jika tidak ada sesi dan bukan di login -> paksa ke login
        if (!session && hash !== '#login') {
            window.location.hash = '#login';
            return;
        }

        // Guard: Jika ada sesi dan di login -> paksa ke dashboard
        if (session && hash === '#login') {
            window.location.hash = '#dashboard';
            return;
        }

        // Setup UI
        hideAllSections();

        if (hash === '#login') {
            document.getElementById('login-section').classList.remove('hidden');
            document.getElementById('navbar').classList.add('hidden');
        } else {
            document.getElementById('navbar').classList.remove('hidden');
            
            // Set state user dari session jika belum ada (misal refresh)
            if (!appState.currentUser) {
                appState.currentUser = session;
            }

            // Load data detail jika belum ada
            if (!appState.profile) {
                await loadUserData();
            } else {
                // Update nama di navbar
                document.getElementById('nav-user-name').textContent = appState.profile?.nama_lengkap?.split(' ')[0] || 'Siswa';
            }

            // Router Switch
            switch (hash) {
                case '#dashboard':
                    document.getElementById('dashboard-section').classList.remove('hidden');
                    renderDashboard();
                    break;
                case '#biodata':
                    document.getElementById('biodata-section').classList.remove('hidden');
                    renderBiodata();
                    break;
                case '#orang-tua':
                    document.getElementById('orang-tua-section').classList.remove('hidden');
                    renderOrangTua();
                    break;
                default:
                    window.location.hash = '#dashboard';
            }
        }

        // Re-render Icons
        if (window.lucide) window.lucide.createIcons();
    }

    function hideAllSections() {
        const sections = ['login-section', 'dashboard-section', 'biodata-section', 'orang-tua-section'];
        sections.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.classList.add('hidden');
        });
    }

    // ==========================================
    // 4. AUTHENTICATION
    // ==========================================

    async function handleLogin(e) {
        e.preventDefault();
        setLoading(true);

        const nisn = document.getElementById('login-nisn').value.trim();
        const tgl = document.getElementById('login-tgl').value;

        try {
            if (!nisn || !tgl) throw new Error("Mohon lengkapi data login.");

            const { data, error } = await supabase
                .from('siswa')
                .select('id_siswa, nama_lengkap, nisn, status')
                .eq('nisn', nisn)
                .eq('tanggal_lahir', tgl)
                .eq('status', 'aktif')
                .single();

            if (error || !data) throw new Error("NISN atau Tanggal Lahir salah / Siswa tidak aktif.");

            // Simpan Session Secure
            appState.currentUser = createSession(data);

            showToast('Login Berhasil!', 'success');
            window.location.hash = '#dashboard';

        } catch (err) {
            showToast(err.message, 'error');
        } finally {
            setLoading(false);
        }
    }

    function handleLogout() {
        destroySession();
        window.location.hash = '#login';
    }

    // ==========================================
    // 5. DATA FETCHING & LOGIC
    // ==========================================

    async function loadUserData() {
        setLoading(true);
        const id = appState.currentUser.id_siswa;

        try {
            // Fetch Siswa & Orang Tua Paralel
            const [siswaRes, ortuRes] = await Promise.all([
                supabase.from('siswa').select('*').eq('id_siswa', id).single(),
                supabase.from('orang_tua').select('*').eq('id_siswa', id)
            ]);

            if (siswaRes.error) throw siswaRes.error;

            appState.profile = siswaRes.data;
            appState.parents = ortuRes.data || [];

            document.getElementById('nav-user-name').textContent = appState.profile.nama_lengkap.split(' ')[0];

        } catch (err) {
            console.error(err);
            showToast("Gagal memuat data user", 'error');
        } finally {
            setLoading(false);
        }
    }

    // --- DASHBOARD LOGIC ---

    function renderDashboard() {
        const p = appState.profile;
        if (!p) return;

        document.getElementById('dash-nama').textContent = p.nama_lengkap;
        document.getElementById('dash-nisn').textContent = p.nisn;
        document.getElementById('dash-status').textContent = p.status.toUpperCase();
        document.getElementById('dash-welcome').textContent = `Halo, ${p.nama_lengkap.split(' ')[0]}`;

        calculateProgress();
    }

    function calculateProgress() {
        const p = appState.profile;
        const parents = appState.parents;
        if (!p) return;

        let score = 0;

        // 1. Biodata (40%)
        if (p.alamat) score += 13;
        if (p.no_telepon) score += 13;
        if (p.status_tinggal) score += 14;

        // 2. Pendidikan (20%)
        if (p.pendidikan_sebelumnya) score += 10;
        if (p.no_ijazah_sebelumnya) score += 10;

        // 3. Foto (10%)
        if (p.foto) score += 10;

        // 4. Orang Tua (30%)
        const ayah = parents.find(x => x.jenis === 'ayah' && x.nama);
        const ibu = parents.find(x => x.jenis === 'ibu' && x.nama);
        if (ayah) score += 15;
        if (ibu) score += 15;

        // Render Progress Bar
        const percent = Math.min(100, score);
        const bar = document.getElementById('progress-bar');
        const text = document.getElementById('progress-percent');
        const statusText = document.getElementById('progress-status-text');

        if (bar && text && statusText) {
            bar.style.width = `${percent}%`;
            text.textContent = `${percent}%`;

            // Warna & Status
            bar.className = 'progress-fill'; // Reset
            if (percent < 50) {
                bar.style.backgroundColor = 'var(--danger)';
                statusText.textContent = 'Belum Lengkap';
                statusText.style.color = 'var(--danger)';
            } else if (percent < 80) {
                bar.style.backgroundColor = 'var(--warning)';
                statusText.textContent = 'Perlu Dilengkapi';
                statusText.style.color = 'var(--warning)';
            } else if (percent < 100) {
                bar.style.backgroundColor = '#3b82f6'; // Blue
                statusText.textContent = 'Hampir Selesai';
                statusText.style.color = '#3b82f6';
            } else {
                bar.style.backgroundColor = 'var(--success)';
                statusText.textContent = 'Lengkap';
                statusText.style.color = 'var(--success)';
            }
        }
    }

    // --- BIODATA LOGIC ---

    function renderBiodata() {
        const p = appState.profile;
        if (!p) return;

        // Isi Form
        document.getElementById('bio-alamat').value = p.alamat || '';
        document.getElementById('bio-telepon').value = p.no_telepon || '';
        document.getElementById('bio-status-tinggal').value = p.status_tinggal || '';
        document.getElementById('bio-sekolah-asal').value = p.pendidikan_sebelumnya || '';
        document.getElementById('bio-no-ijazah').value = p.no_ijazah_sebelumnya || '';

        // Lock Status Check
        const isLocked = p.biodata_status === 'lengkap';
        const formInputs = document.querySelectorAll('#form-biodata input, #form-biodata select, #form-biodata textarea');

        formInputs.forEach(el => el.disabled = isLocked);

        if (isLocked) {
            document.getElementById('locked-message').classList.remove('hidden');
            document.getElementById('bio-buttons').classList.add('hidden');
        } else {
            document.getElementById('locked-message').classList.add('hidden');
            document.getElementById('bio-buttons').classList.remove('hidden');
        }
    }

    async function saveBiodata(status) {
        setLoading(true);

        const alamat = document.getElementById('bio-alamat').value.trim();
        const telepon = document.getElementById('bio-telepon').value.trim();
        const statusTinggal = document.getElementById('bio-status-tinggal').value.trim();
        const sekolahAsal = document.getElementById('bio-sekolah-asal').value.trim();
        const noIjazah = document.getElementById('bio-no-ijazah').value.trim();

        // 1. VALIDASI MANUAL JS (WAJIB) untuk Finalisasi
        if (status === 'lengkap') {
            const missingFields = [];
            if (!alamat) missingFields.push('Alamat');
            if (!telepon) missingFields.push('No. Telepon');
            if (!statusTinggal) missingFields.push('Status Tinggal');
            if (!sekolahAsal) missingFields.push('Sekolah Asal');

            if (missingFields.length > 0) {
                setLoading(false);
                showToast(`Gagal Finalisasi. Field berikut wajib diisi: ${missingFields.join(', ')}`, 'error');
                return;
            }
        }

        const payload = {
            alamat: alamat,
            no_telepon: telepon,
            status_tinggal: statusTinggal,
            pendidikan_sebelumnya: sekolahAsal,
            no_ijazah_sebelumnya: noIjazah,
            biodata_status: status,
            biodata_updated_at: new Date().toISOString()
        };

        try {
            // 2. DOUBLE CHECK STATE (Sebelum Update)
            // Memastikan user tidak memanipulasi DOM untuk bypass validasi
            if (status === 'lengkap') {
                if (!payload.alamat || !payload.no_telepon || !payload.status_tinggal || !payload.pendidikan_sebelumnya) {
                    throw new Error("Validasi data gagal. Mohon periksa kembali inputan Anda.");
                }
            }

            const { error } = await supabase
                .from('siswa')
                .update(payload)
                .eq('id_siswa', appState.currentUser.id_siswa);

            if (error) throw error;

            // Update Local State
            appState.profile = { ...appState.profile, ...payload };

            if (status === 'lengkap') {
                showToast('Biodata berhasil difinalisasi!', 'success');
                renderBiodata(); // Refresh UI lock
            } else {
                showToast('Biodata disimpan sementara.', 'success');
            }

            // 3. AUTO UPDATE PROGRESS
            calculateProgress();

        } catch (err) {
            showToast('Gagal menyimpan: ' + err.message, 'error');
        } finally {
            setLoading(false);
        }
    }

    // --- ORANG TUA LOGIC ---

    function renderOrangTua() {
        // Setup Tabs Logic
        const tabs = document.querySelectorAll('.tab-btn');
        tabs.forEach(tab => {
            tab.onclick = () => switchParentTab(tab.dataset.target);
        });

        // Default load Ayah
        switchParentTab('ayah');
    }

    function switchParentTab(jenis) {
        // UI Tabs Active State
        document.querySelectorAll('.tab-btn').forEach(t => {
            t.classList.toggle('active', t.dataset.target === jenis);
        });

        document.getElementById('lbl-btn-ortu').textContent = jenis === 'ayah' ? 'Ayah' : 'Ibu';
        document.getElementById('ortu-jenis').value = jenis;

        // Load Data to Form
        const data = appState.parents.find(p => p.jenis === jenis) || {};

        document.getElementById('ortu-id-ayah').value = data.jenis === 'ayah' ? (data.id || '') : '';
        document.getElementById('ortu-id-ibu').value = data.jenis === 'ibu' ? (data.id || '') : '';

        document.getElementById('ortu-nama').value = data.nama || '';
        document.getElementById('ortu-ttl').value = data.ttl || '';
        document.getElementById('ortu-agama').value = data.agama || 'Islam';
        document.getElementById('ortu-pekerjaan').value = data.pekerjaan || '';
        document.getElementById('ortu-penghasilan').value = data.penghasilan || '';
        document.getElementById('ortu-status-hidup').value = data.status_hidup || 'Hidup';
        document.getElementById('ortu-alamat').value = data.alamat || '';
    }

    async function saveOrangTua(e) {
        e.preventDefault();
        setLoading(true);

        const jenis = document.getElementById('ortu-jenis').value;
        const id_siswa = appState.currentUser.id_siswa;

        // Cari ID record jika ada di state
        const existing = appState.parents.find(p => p.jenis === jenis);
        const id = existing ? existing.id : null;

        const nama = document.getElementById('ortu-nama').value.trim();
        
        if (!nama) {
            setLoading(false);
            showToast('Nama orang tua wajib diisi', 'error');
            return;
        }

        const payload = {
            id_siswa: id_siswa,
            jenis: jenis,
            nama: nama,
            ttl: document.getElementById('ortu-ttl').value.trim(),
            agama: document.getElementById('ortu-agama').value,
            pekerjaan: document.getElementById('ortu-pekerjaan').value.trim(),
            penghasilan: parseInt(document.getElementById('ortu-penghasilan').value) || 0,
            status_hidup: document.getElementById('ortu-status-hidup').value,
            alamat: document.getElementById('ortu-alamat').value.trim()
        };

        try {
            let result;
            if (id) {
                // Update
                result = await supabase
                    .from('orang_tua')
                    .update(payload)
                    .eq('id', id)
                    .select();
            } else {
                // Insert
                result = await supabase
                    .from('orang_tua')
                    .insert([payload])
                    .select();
            }

            if (result.error) throw result.error;

            // Update Local State array
            const newRecord = result.data[0];
            const idx = appState.parents.findIndex(p => p.jenis === jenis);
            if (idx >= 0) {
                appState.parents[idx] = newRecord;
            } else {
                appState.parents.push(newRecord);
            }

            // Auto Draft Biodata Status agar tidak null / stuck di lengkap jika ada perubahan
            if (appState.profile.biodata_status !== 'lengkap') {
                const draftUpdate = { biodata_status: 'draft', biodata_updated_at: new Date().toISOString() };
                await supabase.from('siswa').update(draftUpdate).eq('id_siswa', id_siswa);
                appState.profile = { ...appState.profile, ...draftUpdate };
            }

            // Update Progress
            calculateProgress();

            showToast(`Data ${jenis} berhasil disimpan!`, 'success');

        } catch (err) {
            showToast('Gagal menyimpan: ' + err.message, 'error');
        } finally {
            setLoading(false);
        }
    }

    // ==========================================
    // 6. UI HELPER & EVENT LISTENERS
    // ==========================================

    function setLoading(isLoading) {
        const el = document.getElementById('loading-overlay');
        if (isLoading) el.classList.remove('hidden');
        else el.classList.add('hidden');
    }

    function showToast(message, type = 'info') {
        const container = document.getElementById('toast-container');
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.innerText = message;
        container.appendChild(toast);

        setTimeout(() => {
            toast.remove();
        }, 3000);
    }

    // Event Listeners Initialization
    document.addEventListener('DOMContentLoaded', () => {
        initRouter();

        // Auth
        const loginForm = document.getElementById('form-login');
        if (loginForm) loginForm.addEventListener('submit', handleLogin);
        
        const logoutBtn = document.getElementById('btn-logout');
        if (logoutBtn) logoutBtn.addEventListener('click', handleLogout);

        // Biodata
        const btnDraft = document.getElementById('btn-bio-draft');
        if (btnDraft) btnDraft.addEventListener('click', () => saveBiodata('draft'));
        
        const bioForm = document.getElementById('form-biodata');
        if (bioForm) bioForm.addEventListener('submit', (e) => {
            e.preventDefault();
            if (confirm('Apakah Anda yakin ingin finalisasi? Data tidak bisa diubah lagi setelah ini.')) {
                saveBiodata('lengkap');
            }
        });

        // Orang Tua
        const ortuForm = document.getElementById('form-orang-tua');
        if (ortuForm) ortuForm.addEventListener('submit', saveOrangTua);
    });

})();
