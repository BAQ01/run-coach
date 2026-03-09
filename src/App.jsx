import { useState, useEffect, useCallback } from 'react'
import { Capacitor } from '@capacitor/core'
import { useAuth } from './hooks/useAuth'
import { supabase } from './lib/supabase'
import AuthScreen from './screens/AuthScreen'
import OnboardingScreen from './screens/OnboardingScreen'
import DashboardScreen from './screens/DashboardScreen'
import ActiveRunScreen from './screens/ActiveRunScreen'
import PostRunScreen from './screens/PostRunScreen'
import RunHistoryScreen from './screens/RunHistoryScreen'
import RunDetailScreen from './screens/RunDetailScreen'
import { WorkoutAudio } from './hooks/useAudioEngine'

const AppView = {
  ONBOARDING:  'ONBOARDING',
  DASHBOARD:   'DASHBOARD',
  ACTIVE_RUN:  'ACTIVE_RUN',
  POST_RUN:    'POST_RUN',
  RUN_HISTORY: 'RUN_HISTORY',
  RUN_DETAIL:  'RUN_DETAIL',
}

const STORAGE_KEY = 'activeWorkout'
const MAX_RESUME_AGE_MS = 24 * 60 * 60 * 1000 // 24 uur

function loadSavedWorkout() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const data = JSON.parse(raw)
    if (!data?.session || !data?.savedAt) return null
    if (Date.now() - data.savedAt > MAX_RESUME_AGE_MS) {
      localStorage.removeItem(STORAGE_KEY)
      return null
    }
    // Bereken hoever de training nu is (inclusief de tijd dat app weg was)
    const resumeElapsed = data.elapsedSeconds + (Date.now() - data.savedAt) / 1000
    const totalDuration = data.session.intervals?.reduce((s, iv) => s + iv.durationSeconds, 0) ?? 0
    if (resumeElapsed >= totalDuration - 5) {
      localStorage.removeItem(STORAGE_KEY)
      return null
    }
    return { session: data.session, planId: data.planId, voice: data.voice, elapsedSeconds: Math.floor(resumeElapsed) }
  } catch (_) { return null }
}

export default function App() {
  const { user, loading } = useAuth()
  const [view, setView] = useState(AppView.ONBOARDING)
  const [plans, setPlans] = useState([])
  const [activePlan, setActivePlan] = useState(null)   // alleen tijdens run
  const [activeSession, setActiveSession] = useState(null)
  const [activeInitialElapsed, setActiveInitialElapsed] = useState(0)
  const [runElapsed, setRunElapsed] = useState(0)
  const [planLoading, setPlanLoading] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const [resumeWorkout, setResumeWorkout] = useState(null)
  const [autoAttach, setAutoAttach] = useState(false)
  const [selectedLog, setSelectedLog] = useState(null)

  const loadAllPlans = useCallback(async () => {
    if (!user) return
    setPlanLoading(true)

    // Controleer native status EERST, terwijl spinner nog zichtbaar is.
    // Native > localStorage: als native loopt, nooit de banner tonen.
    let nativeElapsed = null
    if (Capacitor.isNativePlatform()) {
      try {
        const status = await WorkoutAudio.getStatus()
        console.log('[App] WorkoutAudio.getStatus():', JSON.stringify(status))
        if (status.state === 'running') nativeElapsed = status.elapsedSeconds
      } catch (e) {
        console.warn('[App] getStatus() mislukt:', e?.message ?? e)
      }
    }

    const { data, error } = await supabase
      .from('training_plans')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })

    setPlanLoading(false)
    if (error) {
      console.error('[App] Plans laden mislukt:', error.message)
      setView(AppView.ONBOARDING)
      return
    }
    setPlans(data ?? [])

    // Als native loopt: direct koppelen, geen banner, geen IDLE scherm
    if (nativeElapsed !== null) {
      const saved = loadSavedWorkout()
      if (saved) {
        setActivePlan({ id: saved.planId })
        setActiveSession(saved.session)
        setActiveInitialElapsed(Math.floor(nativeElapsed))
        setAutoAttach(true)
        setView(AppView.ACTIVE_RUN)
        return
      }
    }

    // Normale flow: dashboard + optioneel hervattingsbanner
    setView(data && data.length > 0 ? AppView.DASHBOARD : AppView.ONBOARDING)
    const saved = loadSavedWorkout()
    if (saved) setResumeWorkout(saved)
  }, [user])

  useEffect(() => {
    if (!user) return
    loadAllPlans()
  }, [user, loadAllPlans])

  const handleOnboardingComplete = (plan) => {
    setPlans(prev => [plan, ...prev])
    setView(AppView.DASHBOARD)
  }

  const handleStartWorkout = (plan, session) => {
    setActivePlan(plan)
    setActiveSession(session)
    setActiveInitialElapsed(0)
    setView(AppView.ACTIVE_RUN)
  }

  const handleResumeWorkout = (saved) => {
    setActivePlan({ id: saved.planId })
    setActiveSession(saved.session)
    setActiveInitialElapsed(saved.elapsedSeconds)
    setResumeWorkout(null)
    setView(AppView.ACTIVE_RUN)
  }

  const handleRunDone = (elapsed) => {
    setRunElapsed(elapsed ?? 0)
    setActiveInitialElapsed(0)
    setAutoAttach(false)
    if (elapsed && elapsed > 60) {
      setView(AppView.POST_RUN)
    } else {
      setView(AppView.DASHBOARD)
    }
  }

  const handlePostRunComplete = () => {
    setActiveSession(null)
    setActivePlan(null)
    setActiveInitialElapsed(0)
    setView(AppView.DASHBOARD)
    setRefreshKey(k => k + 1)  // DashboardScreen herlaadt workout_logs
  }

  const handleNewPlan = () => {
    setView(AppView.ONBOARDING)
  }

  const handlePlanDeleted = (planId) => {
    setPlans(prev => prev.filter(p => p.id !== planId))
  }

  const handleOpenHistory = () => {
    setView(AppView.RUN_HISTORY)
  }

  const handleSelectLog = (log) => {
    setSelectedLog(log)
    setView(AppView.RUN_DETAIL)
  }

  const handleBackFromDetail = () => {
    setView(AppView.RUN_HISTORY)
  }

  const handleBackFromHistory = () => {
    setSelectedLog(null)
    setView(AppView.DASHBOARD)
  }

  if (loading || planLoading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-center">
          <div className="text-3xl mb-4">🏃</div>
          <div className="w-8 h-8 border-2 border-[#39FF14] border-t-transparent rounded-full animate-spin mx-auto" />
        </div>
      </div>
    )
  }

  if (!user) return <AuthScreen />

  if (view === AppView.ONBOARDING) return (
    <OnboardingScreen
      onComplete={handleOnboardingComplete}
      onCancel={plans.length > 0 ? () => setView(AppView.DASHBOARD) : null}
    />
  )
  if (view === AppView.DASHBOARD) return (
    <DashboardScreen
      plans={plans}
      onStartWorkout={handleStartWorkout}
      onNewPlan={handleNewPlan}
      refreshKey={refreshKey}
      resumeWorkout={resumeWorkout}
      onResumeWorkout={handleResumeWorkout}
      onPlanDeleted={handlePlanDeleted}
      onOpenHistory={handleOpenHistory}
    />
  )
  if (view === AppView.RUN_HISTORY) return (
    <RunHistoryScreen
      plans={plans}
      onBack={handleBackFromHistory}
      onSelectLog={handleSelectLog}
    />
  )
  if (view === AppView.RUN_DETAIL && selectedLog) return (
    <RunDetailScreen
      logId={selectedLog.id}
      plans={plans}
      onBack={handleBackFromDetail}
    />
  )
  if (view === AppView.ACTIVE_RUN && activeSession) return (
    <ActiveRunScreen
      session={activeSession}
      planId={activePlan?.id}
      initialElapsed={activeInitialElapsed}
      onDone={handleRunDone}
      autoAttach={autoAttach}
    />
  )
  if (view === AppView.POST_RUN && activeSession && activePlan) return (
    <PostRunScreen
      session={activeSession}
      planId={activePlan.id}
      elapsedSeconds={runElapsed}
      onComplete={handlePostRunComplete}
    />
  )

  return <OnboardingScreen onComplete={handleOnboardingComplete} onCancel={null} />
}
