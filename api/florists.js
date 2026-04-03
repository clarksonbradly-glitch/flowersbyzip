export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { zip, lat, lng, radius = 25 } = req.query;

  try {
    const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
    const BASE_ID = process.env.AIRTABLE_BASE_ID;
    const TABLE_ID = process.env.AIRTABLE_TABLE_ID;
    const MAPS_KEY = process.env.GOOGLE_MAPS_KEY;

    // Fetch approved florists from Airtable
    const url = `https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}?filterByFormula=({Status}="Approved")&pageSize=100`;
    const airtableRes = await fetch(url, {
      headers: { 'Authorization': `Bearer ${AIRTABLE_TOKEN}` }
    });

    if (!airtableRes.ok) {
      const err = await airtableRes.text();
      return res.status(500).json({ error: 'Airtable error', detail: err });
    }

    const data = await airtableRes.json();
    const records = data.records || [];

    // Geocode the search ZIP using a server-side key (no referrer restriction needed)
    // We use the Geocoding API which should be unrestricted for server use
    let centerLat = parseFloat(lat) || null;
    let centerLng = parseFloat(lng) || null;

    if (zip && (!centerLat || !centerLng) && MAPS_KEY) {
      try {
        const geoRes = await fetch(
          `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(zip + ', USA')}&key=${MAPS_KEY}`
        );
        const geoData = await geoRes.json();
        if (geoData.results && geoData.results[0]) {
          centerLat = geoData.results[0].geometry.location.lat;
          centerLng = geoData.results[0].geometry.location.lng;
        }
      } catch(e) {}
    }

    const emojis = ['🌸','🌺','🌼','🌻','💐','🌷','🌱','🪷'];
    const colors = ['#e8f2e8','#faeae4','#faf3e0','#f0f4e8','#f0e8f4','#e8f0f4','#f4f0e8','#eef0f8'];

    // Build florist list — geocode each address
    const florists = await Promise.all(records.map(async (record, i) => {
      const f = record.fields;
      const address = [f['Street Address'], f['City'], f['State'], f['ZIP Code']].filter(Boolean).join(', ');

      let floristLat = null;
      let floristLng = null;
      let distance = null;

      // Geocode florist address
      if (address && MAPS_KEY) {
        try {
          const geoRes = await fetch(
            `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${MAPS_KEY}`
          );
          const geoData = await geoRes.json();
          if (geoData.results && geoData.results[0]) {
            floristLat = geoData.results[0].geometry.location.lat;
            floristLng = geoData.results[0].geometry.location.lng;
            if (centerLat && centerLng) {
              distance = haversine(centerLat, centerLng, floristLat, floristLng);
            }
          }
        } catch(e) {}
      }

      const specialties = Array.isArray(f['Specialties'])
        ? f['Specialties']
        : (f['Specialties'] ? f['Specialties'].split(',').map(s => s.trim()) : ['Independent Florist']);

      return {
        id: record.id,
        name: f['Shop Name'] || '',
        owner: f['Owner Name'] || '',
        address: [f['Street Address'], f['City'], f['State']].filter(Boolean).join(', '),
        city: f['City'] || '',
        state: f['State'] || '',
        zip: f['ZIP Code'] || '',
        phone: f['Phone'] || '',
        email: f['Email'] || '',
        website: f['Website'] || '#',
        description: f['Description'] || '',
        specialties: specialties,
        yearEstablished: f['Year Established'] || null,
        emoji: emojis[i % emojis.length],
        color: colors[i % colors.length],
        sameDay: specialties.some(s => s.toLowerCase().includes('same-day') || s.toLowerCase().includes('same day')),
        rating: 0,
        reviews: 0,
        distance: distance !== null ? parseFloat(distance.toFixed(1)) : null,
        lat: floristLat,
        lng: floristLng,
      };
    }));

    // Sort by distance, nulls last
    florists.sort((a, b) => {
      if (a.distance === null && b.distance === null) return 0;
      if (a.distance === null) return 1;
      if (b.distance === null) return -1;
      return a.distance - b.distance;
    });

    return res.status(200).json({
      florists: florists,
      total: florists.length,
      center: { lat: centerLat, lng: centerLng },
      debug: {
        mapsKeyPresent: !!MAPS_KEY,
        mapsKeyLength: (MAPS_KEY||'').length,
        centerLat,
        centerLng,
        recordCount: records.length
      }
    });

  } catch (err) {
    return res.status(500).json({ error: 'Server error', detail: err.message });
  }
}

function haversine(lat1, lng1, lat2, lng2) {
  const R = 3958.8;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 +
    Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}
