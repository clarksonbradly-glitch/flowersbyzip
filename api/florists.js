export default async function handler(req, res) {
  // Allow CORS so flowersbyzip.com can call this
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { zip, lat, lng, radius = 25 } = req.query;

  if (!zip && (!lat || !lng)) {
    return res.status(400).json({ error: 'Please provide a zip or lat/lng' });
  }

  try {
    const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
    const BASE_ID = process.env.AIRTABLE_BASE_ID;
    const TABLE_ID = process.env.AIRTABLE_TABLE_ID;

    // Fetch all Approved florists from Airtable
    const url = `https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}?filterByFormula=({Status}="Approved")&pageSize=100`;

    const airtableRes = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${AIRTABLE_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });

    if (!airtableRes.ok) {
      const err = await airtableRes.text();
      return res.status(500).json({ error: 'Airtable error', detail: err });
    }

    const data = await airtableRes.json();
    const records = data.records || [];

    // If we have a ZIP, geocode it to get lat/lng for distance calc
    let centerLat = parseFloat(lat);
    let centerLng = parseFloat(lng);

    if (zip && (!lat || !lng)) {
      const geoRes = await fetch(
        `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(zip + ', USA')}&key=${process.env.GOOGLE_MAPS_KEY}`
      );
      const geoData = await geoRes.json();
      if (geoData.results && geoData.results[0]) {
        centerLat = geoData.results[0].geometry.location.lat;
        centerLng = geoData.results[0].geometry.location.lng;
      }
    }

    // Geocode each florist address and calculate distance
    const florists = await Promise.all(
      records.map(async (record, i) => {
        const f = record.fields;
        const address = `${f['Street Address'] || ''} ${f['City'] || ''} ${f['State'] || ''} ${f['ZIP Code'] || ''}`.trim();

        let floristLat = null;
        let floristLng = null;
        let distance = null;

        // Geocode florist address
        if (address && centerLat && centerLng) {
          try {
            const geoRes = await fetch(
              `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${process.env.GOOGLE_MAPS_KEY}`
            );
            const geoData = await geoRes.json();
            if (geoData.results && geoData.results[0]) {
              floristLat = geoData.results[0].geometry.location.lat;
              floristLng = geoData.results[0].geometry.location.lng;
              distance = haversine(centerLat, centerLng, floristLat, floristLng);
            }
          } catch (e) {
            // If geocoding fails, still include the florist without distance
          }
        }

        const emojis = ['🌸','🌺','🌼','🌻','💐','🌷','🌱','🪷'];
        const colors = ['#e8f2e8','#faeae4','#faf3e0','#f0f4e8','#f0e8f4','#e8f0f4','#f4f0e8','#eef0f8'];

        return {
          id: record.id,
          name: f['Shop Name'] || '',
          owner: f['Owner Name'] || '',
          address: `${f['Street Address'] || ''}, ${f['City'] || ''}, ${f['State'] || ''}`.trim(),
          city: f['City'] || '',
          state: f['State'] || '',
          zip: f['ZIP Code'] || '',
          phone: f['Phone'] || '',
          email: f['Email'] || '',
          website: f['Website'] || '#',
          description: f['Description'] || '',
          specialties: Array.isArray(f['Specialties']) ? f['Specialties'] : (f['Specialties'] ? f['Specialties'].split(',').map(s => s.trim()) : ['Independent Florist']),
          yearEstablished: f['Year Established'] || null,
          emoji: emojis[i % emojis.length],
          color: colors[i % colors.length],
          sameDay: Array.isArray(f['Specialties']) ? f['Specialties'].some(s => s.toLowerCase().includes('same-day')) : (f['Specialties'] ? f['Specialties'].toLowerCase().includes('same-day') : false),
          rating: 0,
          reviews: 0,
          distance: distance ? parseFloat(distance.toFixed(1)) : null,
          lat: floristLat,
          lng: floristLng,
        };
      })
    );

    // Filter by radius and sort by distance
    const radiusMiles = parseFloat(radius);
    const nearby = florists
      .filter(f => f.distance === null || f.distance <= radiusMiles)
      .sort((a, b) => {
        if (a.distance === null) return 1;
        if (b.distance === null) return -1;
        return a.distance - b.distance;
      });

    return res.status(200).json({
      florists: nearby,
      total: nearby.length,
      center: { lat: centerLat, lng: centerLng }
    });

  } catch (err) {
    return res.status(500).json({ error: 'Server error', detail: err.message });
  }
}

// Haversine formula — calculates distance in miles between two lat/lng points
function haversine(lat1, lng1, lat2, lng2) {
  const R = 3958.8; // Earth radius in miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
