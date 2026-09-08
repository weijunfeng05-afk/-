import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import CloudAccess from './CloudAccess';
import './style.css';
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><CloudAccess><App/></CloudAccess></React.StrictMode>);
