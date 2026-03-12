import * as cheerio from 'cheerio';

const generatorEmail = {
  api: {
    base: 'https://generator.email/',
    validate: 'check_adres_validation3.php'
  },
  h: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Referer': 'https://generator.email/',
    'Accept-Language': 'en-US,en;q=0.9'
  },

  _f: async (u, o, r = 5) => {
    for (let i = 0, e; i < r; i++) {
      try {
        const res = await fetch(u, o);
        if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
        return o._t ? await res.text() : await res.json();
      } catch (err) {
        e = err.message;
        if (i === r - 1) throw new Error(e);
      }
    }
  },

  _v: async function(u, d) {
    try {
      return await this._f(this.api.base + this.api.validate, {
        method: 'POST',
        headers: { 
          ...this.h, 
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Requested-With': 'XMLHttpRequest'
        },
        body: new URLSearchParams({ usr: u, dmn: d })
      });
    } catch (e) { return { err: e.message }; }
  },

  _p: (e) => e?.includes('@') ? e.split('@') : null,

  generate: async function() {
    try {
      const html = await this._f(this.api.base, { headers: this.h, cache: 'no-store', _t: 1 });
      const $ = cheerio.load(html);
      const em = $('#email_ch_text').text();
      
      if (!em) return { success: false, result: 'Gagal generate email. Coba lagi nanti.' };

      const [u, d] = this._p(em);
      const v = await this._v(u, d);
      return { 
        success: true, 
        result: { 
          email: em, 
          status: v.status || "Active", 
          uptime: v.uptime || "Just now"
        } 
      };
    } catch (e) { return { success: false, result: e.message }; }
  },

  inbox: async function(em) {
    const p = this._p(em);
    if (!p) return { success: false, result: 'Format email tidak valid' };

    const [u, d] = p;
    const ck = `surl=${d}/${u}`;
    
    try {
      const h = await this._f(this.api.base, { 
        headers: { ...this.h, Cookie: ck }, 
        cache: 'no-store', 
        _t: 1 
      });

      if (h.includes('Email generator is ready')) {
        return { success: true, result: { email: em, inbox: [] } };
      }

      const $ = cheerio.load(h);
      const c = parseInt($('#mess_number').text()) || 0;
      const ib = [];

      if (c === 1) {
        const el = $('#email-table .e7m.row');
        const sp = el.find('.e7m.col-md-9 span');
        ib.push({
          from: sp.eq(3).text().replace(/\(.*?\)/, '').trim(),
          subject: el.find('h1').text().trim(),
          time: el.find('.e7m.tooltip').text().replace('Created: ', '').trim(),
          message: el.find('.e7m.mess_bodiyy').text().trim()
        });
      } else if (c > 1) {
        const links = $('#email-table a').map((_, a) => $(a).attr('href')).get();
        for (const l of links) {
          const mHtml = await this._f(this.api.base, { 
            headers: { ...this.h, Cookie: `surl=${l.replace('/', '')}` }, 
            cache: 'no-store', 
            _t: 1 
          });
          const m = cheerio.load(mHtml);
          const sp = m('.e7m.col-md-9 span');
          ib.push({
            from: sp.eq(3).text().replace(/\(.*?\)/, '').trim(),
            subject: m('h1').text().trim(),
            time: m('.e7m.tooltip').text().replace('Created: ', '').trim(),
            message: m('.e7m.mess_bodiyy').text().trim()
          });
        }
      }
      return { success: true, result: { email: em, count: c, inbox: ib } };
    } catch (e) {
      return { success: false, result: e.message };
    }
  }
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { action, email } = req.query;

  try {
    if (action === 'generate') {
      const data = await generatorEmail.generate();
      return res.status(200).json(data);
    } 
    else if (action === 'inbox' && email) {
      const data = await generatorEmail.inbox(email);
      return res.status(200).json(data);
    } 
    else {
      return res.status(400).json({ success: false, message: 'Gunakan ?action=generate atau ?action=inbox&email=...' });
    }
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
}
