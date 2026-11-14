// OpenDone runtime configuration.
//
// backend:
//   'auto'     – use the OpenDone server if this page is served by one,
//                otherwise Firebase (if configured below), otherwise local storage.
//   'local'    – always store in this browser only.
//   'server'   – always use the OpenDone server on this origin.
//   'firebase' – always use Firebase (needs the config below).
//
// firebase: paste your Firebase web config here to sync through Firebase
// (GitHub login + Firestore). Leave null to not use Firebase.
window.OPENDONE_CONFIG = {
  backend: 'auto',
  firebase: null,
};
