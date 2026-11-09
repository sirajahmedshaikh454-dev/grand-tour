// Ready-made missions, found with tools/find-voyager.mjs and tools/find-mars.mjs against THIS simulator.
// burns[].after is days after launch.
export const PRESETS = [
  {
    id: 'voyager-jupiter', name: 'Voyager 2 to Jupiter',
    blurb: 'Launch on the real day, 20 Aug 1977, at about the real speed. No corrections: you reach Jupiter on 9 July 1979, the day Voyager 2 did.',
    date: '1977-08-20T14:29:00Z', vinf: 9.878, angle: 17.46, pitch: 10.0, burns: [],
  },
  {
    id: 'voyager-saturn', name: 'Jupiter, then Saturn',
    blurb: 'The same launch plus one 27 m/s nudge at day 90. Jupiter hurls you from 11 to 22 km/s toward Saturn, which you pass at 101,000 km, as Voyager 2 did. (Here: May 1979 and March 1981. The real mission: July 1979 and August 1981.) These numbers need nine digits: round them and Saturn becomes a crash.',
    date: '1977-08-20T14:29:00Z', vinf: 10.283172286, angle: 18.465671668, pitch: 10.000004576, burns: [{ after: 90, pro: -26.683972752, norm: 0.50047473965 }],
  },
  {
    id: 'mars-sprint', name: 'Mars sprint',
    blurb: 'A fast, expensive route to Mars from the 2020 launch window: 111 days instead of the usual 7 months.',
    date: '2020-07-30T12:00:00Z', vinf: 5.2296, angle: -9.28, pitch: -1.68, burns: [],
  },
  {
    id: 'blank', name: 'Blank sheet',
    blurb: 'Pick your own date. The challenge nobody has finished here: Jupiter, Saturn, Uranus and Neptune on one flight.',
    date: '1977-08-20T14:29:00Z', vinf: 9.0, angle: 15, pitch: 5, burns: [],
  },
];
