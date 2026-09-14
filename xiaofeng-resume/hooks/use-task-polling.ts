'use client';
import {useEffect,useRef} from 'react';
import {startTaskPolling} from '@/lib/polling';
export function useTaskPolling(refresh:()=>Promise<unknown>,running:boolean){
 const latest=useRef(refresh);useEffect(()=>{latest.current=refresh},[refresh]);
 useEffect(()=>startTaskPolling(()=>latest.current(),running,document),[running]);
}
