import React, { useState, useEffect, useRef } from 'react';
import { User, UserRole, Question, Quiz, QuizStatus, Submission } from './types';
import { MockBackend } from './services/mockBackend';
import { formatTime, cn } from './utils';

// --- Components ---

const Button = ({ className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
  <button
    className={cn(
      "px-4 py-2 rounded-md font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2",
      "bg-blue-600 text-white hover:bg-blue-700 focus:ring-blue-500",
      "disabled:opacity-50 disabled:cursor-not-allowed",
      className
    )}
    {...props}
  />
);

const Input = ({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) => (
  <input
    className={cn(
      "w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500",
      className
    )}
    {...props}
  />
);

const Card = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <div className={cn("bg-white shadow rounded-lg p-6", className)}>{children}</div>
);

// --- App ---

export default function App() {
  const [view, setView] = useState<'LOGIN_SELECT' | 'STUDENT_LOGIN' | 'STUDENT_REGISTER' | 'REGISTRATION_SUCCESS' | 'ADMIN_LOGIN' | 'STUDENT_LOBBY' | 'ADMIN_DASHBOARD'>('LOGIN_SELECT');
  const [user, setUser] = useState<User | null>(null);
  
  // Registration State
  const [regName, setRegName] = useState('');
  const [regAge, setRegAge] = useState('');
  const [regVillage, setRegVillage] = useState('');
  const [generatedCode, setGeneratedCode] = useState<string | null>(null);

  // Login State
  const [studentCode, setStudentCode] = useState('');
  const [adminUser, setAdminUser] = useState('');
  const [adminPass, setAdminPass] = useState('');
  const [error, setError] = useState('');

  // Quiz State
  const [activeQuiz, setActiveQuiz] = useState<Quiz | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  
  // Interactive Quiz State
  const [currentQIndex, setCurrentQIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [globalTimeLeft, setGlobalTimeLeft] = useState(0); // 10 mins total
  const [questionTimeLeft, setQuestionTimeLeft] = useState(60); // 1 min per question
  const [feedback, setFeedback] = useState<{selectedId: string, isCorrect: boolean} | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [result, setResult] = useState<number | null>(null);

  // Admin Data
  const [students, setStudents] = useState<User[]>([]);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [onlineCount, setOnlineCount] = useState(0);

  // Refs for timers to avoid stale closures in intervals
  const submitRef = useRef(handleSubmitQuiz);
  
  // Update ref
  useEffect(() => {
    submitRef.current = handleSubmitQuiz;
  });

  useEffect(() => {
    const cleanup = MockBackend.subscribeToEvents((event) => {
      if (event.type === 'QUIZ_PUBLISHED') {
        if (user?.role === UserRole.STUDENT) {
          loadActiveQuiz();
        }
      }
      if (event.type === 'ONLINE_COUNT_UPDATE') {
        setOnlineCount(event.data);
      }
      if (event.type === 'SUBMISSION_RECEIVED') {
        // Refresh admin data if looking at dashboard
        if (user?.role === UserRole.ADMIN) {
           loadAdminData();
        }
      }
    });
    return cleanup;
  }, [user]);

  // Global Quiz Timer (10 mins)
  useEffect(() => {
    let timer: any;
    if (activeQuiz && globalTimeLeft > 0 && !submitted && view === 'STUDENT_LOBBY') {
      timer = setInterval(() => {
        setGlobalTimeLeft((prev) => {
          if (prev <= 1) {
            submitRef.current(); // Auto submit when total time is up
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [activeQuiz, globalTimeLeft, submitted, view]);

  // Question Timer (1 min)
  useEffect(() => {
    let timer: any;
    if (activeQuiz && !submitted && view === 'STUDENT_LOBBY' && !feedback && questions.length > 0) {
      // Only tick if not currently showing feedback animation
      timer = setInterval(() => {
        setQuestionTimeLeft((prev) => {
          if (prev <= 1) {
            handleNextQuestion(); // Auto skip question
            return 60; 
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [activeQuiz, submitted, view, feedback, currentQIndex, questions.length]);


  const loadActiveQuiz = async () => {
    const quiz = await MockBackend.getActiveQuiz();
    if (quiz) {
      setActiveQuiz(quiz);
      const allQs = await MockBackend.getQuestions();
      // Ensure we get exactly 10 questions for the daily quiz logic
      const quizQs = allQs.slice(0, 10); // Mock logic: take first 10
      setQuestions(quizQs);
      
      // Setup Timers
      if (quiz.publishedAt) {
        // Reset local state for new quiz
        setCurrentQIndex(0);
        setAnswers({});
        setFeedback(null);
        setSubmitted(false);
        setQuestionTimeLeft(60);
        
        // Calculate remaining global time
        const elapsed = Math.floor((Date.now() - quiz.publishedAt) / 1000);
        const remaining = (10 * 60) - elapsed; // 10 minutes hard limit
        setGlobalTimeLeft(remaining > 0 ? remaining : 0);
      }
    }
  };

  const handleStudentLogin = async () => {
    try {
      const u = await MockBackend.loginStudent(studentCode);
      setUser(u);
      setView('STUDENT_LOBBY');
      loadActiveQuiz();
      setError('');
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleStudentRegister = async () => {
    try {
      if (!regName || !regAge || !regVillage) {
        setError("All fields are required");
        return;
      }
      const ageNum = parseInt(regAge);
      if (isNaN(ageNum) || ageNum <= 0) {
        setError("Please enter a valid age");
        return;
      }

      const newUser = await MockBackend.registerStudent(regName, ageNum, regVillage);
      setGeneratedCode(newUser.id);
      setView('REGISTRATION_SUCCESS');
      setError('');
    } catch (err: any) {
      setError(err.message);
    }
  };

  const copyCodeToClipboard = () => {
    if (generatedCode) {
      navigator.clipboard.writeText(generatedCode);
      alert('Code copied to clipboard!');
    }
  };

  const handleAdminLogin = async () => {
    try {
      const u = await MockBackend.loginAdmin(adminUser, adminPass);
      setUser(u);
      setView('ADMIN_DASHBOARD');
      loadAdminData();
      setError('');
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleAdminKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleAdminLogin();
  };

  const loadAdminData = async () => {
    const s = await MockBackend.getStudents();
    setStudents(s);
    
    // Also fetch submissions to show scores
    const quiz = await MockBackend.getActiveQuiz();
    if (quiz) {
      const subs = await MockBackend.getSubmissions(quiz.id);
      setSubmissions(subs);
    }
  };

  // Student Interaction
  const handleOptionClick = (questionId: string, optionId: string) => {
    if (feedback) return; // Prevent clicking during transition
    
    const currentQ = questions[currentQIndex];
    const isCorrect = optionId === currentQ.correctAnswer;
    
    // Record Answer
    setAnswers(prev => ({ ...prev, [questionId]: optionId }));
    
    // Immediate Feedback
    setFeedback({ selectedId: optionId, isCorrect });
    
    // Wait then move next
    setTimeout(() => {
      handleNextQuestion();
    }, 1000); // 1 second delay to see color
  };

  const handleNextQuestion = () => {
    setFeedback(null);
    setQuestionTimeLeft(60); // Reset Q timer
    
    if (currentQIndex < questions.length - 1) {
      setCurrentQIndex(prev => prev + 1);
    } else {
      // Last question finished
      submitRef.current();
    }
  };

  // Re-defined properly as a function expression for the Ref to capture
  async function handleSubmitQuiz() {
    if (!user || !activeQuiz || submitted) return;
    setSubmitted(true);
    
    const submission: Submission = {
      quizId: activeQuiz.id,
      studentId: user.id,
      answers: Object.entries(answers).map(([k, v]) => ({ questionId: k, value: v })),
      score: 0,
      totalQuestions: questions.length,
      submittedAt: Date.now(),
    };

    const score = MockBackend.calculateScore(questions, submission.answers);
    submission.score = score;
    setResult(score);

    await MockBackend.submitQuiz(submission);
  }

  // Helper to get student score for admin view
  const getStudentScore = (studentId: string) => {
    const sub = submissions.find(s => s.studentId === studentId);
    return sub ? `${sub.score}/${sub.totalQuestions}` : '-';
  };

  // --- Views ---

  if (view === 'LOGIN_SELECT') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <Card className="max-w-md w-full text-center space-y-6">
          <h1 className="text-3xl font-bold text-blue-900">QuizMaster Pro</h1>
          <p className="text-gray-600">Select your portal to continue</p>
          <div className="space-y-3">
            <Button onClick={() => setView('STUDENT_LOGIN')} className="w-full text-lg py-3">Student Login</Button>
            <Button onClick={() => setView('STUDENT_REGISTER')} className="w-full text-lg py-3 bg-green-600 hover:bg-green-700">New Student Registration</Button>
            <Button onClick={() => setView('ADMIN_LOGIN')} className="w-full bg-gray-700 hover:bg-gray-800">Admin Portal</Button>
          </div>
        </Card>
      </div>
    );
  }

  if (view === 'STUDENT_REGISTER') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <Card className="max-w-md w-full space-y-6">
          <h2 className="text-2xl font-bold text-center">Student Registration</h2>
          <p className="text-sm text-gray-500 text-center">Enter your details to generate your Student Code.</p>
          {error && <div className="p-3 bg-red-100 text-red-700 rounded">{error}</div>}
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
              <Input 
                value={regName} 
                onChange={e => setRegName(e.target.value)} 
                placeholder="e.g. John Doe" 
                className="bg-gray-700 text-white placeholder-gray-400 border-gray-600 focus:ring-blue-400 focus:border-blue-400"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Age</label>
              <Input 
                type="number" 
                value={regAge} 
                onChange={e => setRegAge(e.target.value)} 
                placeholder="e.g. 18" 
                className="bg-gray-700 text-white placeholder-gray-400 border-gray-600 focus:ring-blue-400 focus:border-blue-400"
              />
            </div>
             <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Village</label>
              <Input 
                value={regVillage} 
                onChange={e => setRegVillage(e.target.value)} 
                placeholder="e.g. Smallville" 
                className="bg-gray-700 text-white placeholder-gray-400 border-gray-600 focus:ring-blue-400 focus:border-blue-400"
              />
            </div>
            <Button onClick={handleStudentRegister} className="w-full">Register & Get Code</Button>
            <button onClick={() => setView('LOGIN_SELECT')} className="w-full text-sm text-gray-600 hover:underline">Cancel</button>
          </div>
        </Card>
      </div>
    );
  }

  if (view === 'REGISTRATION_SUCCESS') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <Card className="max-w-md w-full space-y-6 text-center">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto">
            <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
          </div>
          <h2 className="text-2xl font-bold text-green-700">Registration Successful!</h2>
          <p className="text-gray-600">Your unique Student Code is:</p>
          
          <div className="bg-gray-100 p-4 rounded-lg border-2 border-dashed border-gray-300">
             <div className="text-4xl font-mono font-bold text-blue-800 tracking-wider">{generatedCode}</div>
          </div>
          
          <Button onClick={copyCodeToClipboard} className="w-full bg-gray-600 hover:bg-gray-700">
             Copy Code
          </Button>
          
          <div className="text-sm text-gray-500">
            Please save this code. You will need it to login.
          </div>

          <Button onClick={() => { setStudentCode(generatedCode || ''); setView('STUDENT_LOGIN'); }} className="w-full">
            Proceed to Login
          </Button>
        </Card>
      </div>
    );
  }

  if (view === 'STUDENT_LOGIN') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <Card className="max-w-md w-full space-y-6">
          <h2 className="text-2xl font-bold text-center">Student Login</h2>
          {error && <div className="p-3 bg-red-100 text-red-700 rounded">{error}</div>}
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">Student Code</label>
              <Input 
                value={studentCode} 
                onChange={e => setStudentCode(e.target.value.toUpperCase())} 
                placeholder="e.g. A01" 
                className="text-center text-xl uppercase placeholder:normal-case"
              />
            </div>
            <Button onClick={handleStudentLogin} className="w-full">Login</Button>
            <div className="text-center">
               <span className="text-sm text-gray-600">Don't have a code? </span>
               <button onClick={() => setView('STUDENT_REGISTER')} className="text-sm text-blue-600 hover:underline">Register here</button>
            </div>
            <button onClick={() => setView('LOGIN_SELECT')} className="w-full text-sm text-gray-600 hover:underline">Back</button>
          </div>
        </Card>
      </div>
    );
  }

  if (view === 'ADMIN_LOGIN') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <Card className="max-w-md w-full space-y-6">
          <h2 className="text-2xl font-bold text-center">Admin Login</h2>
          {error && <div className="p-3 bg-red-100 text-red-700 rounded">{error}</div>}
          <div className="space-y-4">
            <Input 
              value={adminUser} 
              onChange={e => setAdminUser(e.target.value)} 
              placeholder="Admin Username" 
              onKeyDown={handleAdminKeyDown}
            />
            <Input 
              type="password" 
              value={adminPass} 
              onChange={e => setAdminPass(e.target.value)} 
              placeholder="Passcode" 
              onKeyDown={handleAdminKeyDown}
            />
            <Button onClick={handleAdminLogin} className="w-full bg-gray-800 hover:bg-gray-900">Enter</Button>
            <div className="text-center text-xs text-gray-400">
              Default: admin / password
            </div>
            <button onClick={() => setView('LOGIN_SELECT')} className="w-full text-sm text-gray-600 hover:underline">Back</button>
          </div>
        </Card>
      </div>
    );
  }

  if (view === 'STUDENT_LOBBY') {
    if (!activeQuiz) {
      return (
        <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4">
          <Card className="max-w-lg w-full text-center space-y-6">
            <div className="flex justify-between items-center border-b pb-4">
               <div>
                 <h2 className="text-xl font-bold">{user?.name}</h2>
                 <p className="text-sm text-gray-500">Code: {user?.id}</p>
               </div>
               <div className="flex items-center gap-2">
                 <span className="w-3 h-3 bg-green-500 rounded-full animate-pulse"></span>
                 <span className="text-sm font-medium">Online</span>
               </div>
            </div>
            <div className="py-12">
              <h3 className="text-2xl font-light text-gray-600">Waiting for today's quiz...</h3>
              <p className="mt-2 text-gray-500">Please stay on this page.</p>
            </div>
            <Button onClick={() => { setUser(null); setView('LOGIN_SELECT'); }} className="bg-red-100 text-red-700 hover:bg-red-200">Logout</Button>
          </Card>
        </div>
      );
    }

    // Quiz Active
    if (submitted) {
      return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
          <Card className="max-w-lg w-full text-center space-y-6">
             <h2 className="text-3xl font-bold text-green-600">Quiz Completed!</h2>
             <p className="text-lg">You scored</p>
             <div className="text-6xl font-bold text-blue-600">{result} <span className="text-2xl text-gray-400">/ {questions.length}</span></div>
             <p className="text-gray-500">{(result! / questions.length * 100).toFixed(1)}%</p>
             <Button onClick={() => { setUser(null); setView('LOGIN_SELECT'); setSubmitted(false); setActiveQuiz(null); }} className="mt-4">Logout</Button>
          </Card>
        </div>
      );
    }

    // Add loading check here to prevent undefined access
    if (questions.length === 0) {
      return (
        <div className="min-h-screen bg-white flex items-center justify-center">
          <div className="text-xl text-gray-500">Loading questions...</div>
        </div>
      );
    }

    // --- Interactive Quiz View ---
    const currentQ = questions[currentQIndex];

    // Extra safety check in case currentQIndex is out of bounds or question undefined
    if (!currentQ) {
       return <div className="min-h-screen flex items-center justify-center text-red-500">Error: Question not found.</div>;
    }

    return (
      <div className="min-h-screen bg-white pb-20">
        <header className="sticky top-0 bg-white border-b shadow-sm z-10">
          <div className="max-w-3xl mx-auto px-4 py-4 flex justify-between items-center">
             <h1 className="font-bold text-lg truncate">{activeQuiz.title}</h1>
             <div className="flex items-center gap-4">
               {/* Global Timer */}
               <div className={cn("text-lg font-mono font-bold px-3 py-1 rounded border", globalTimeLeft < 60 ? "bg-red-100 text-red-600 border-red-200" : "bg-gray-50 border-gray-200")}>
                 Total: {formatTime(globalTimeLeft)}
               </div>
             </div>
          </div>
        </header>
        
        <main className="max-w-3xl mx-auto px-4 py-8 space-y-8">
           <div className="flex justify-between items-center mb-4">
              <span className="text-sm text-gray-500">Question {currentQIndex + 1} of {questions.length}</span>
              {/* Question Timer */}
              <span className={cn("text-sm font-medium", questionTimeLeft < 10 ? "text-red-600 animate-pulse" : "text-gray-600")}>
                Question Time: {questionTimeLeft}s
              </span>
           </div>

           <div key={currentQ.id} className="bg-white border rounded-lg p-6 shadow-sm space-y-6">
              <p className="text-xl font-medium">{currentQ.text}</p>
              
              <div className="grid grid-cols-1 gap-3">
                {currentQ.options?.map(opt => {
                  let btnClass = "border-gray-300 hover:bg-gray-50";
                  
                  // Apply Styling based on feedback state
                  if (feedback) {
                    if (opt.id === feedback.selectedId) {
                      if (feedback.isCorrect) btnClass = "bg-green-500 text-white border-green-600";
                      else btnClass = "bg-red-500 text-white border-red-600";
                    } else if (opt.id === currentQ.correctAnswer && !feedback.isCorrect) {
                       // Optional: Show correct answer if they got it wrong? 
                       // Prompt didn't explicitly say to show correct if wrong, just red/green on selection.
                       // keeping it simple to user selection.
                    }
                  }

                  return (
                    <button
                      key={opt.id}
                      onClick={() => handleOptionClick(currentQ.id, opt.id)}
                      disabled={!!feedback} // Disable clicks after selection
                      className={cn(
                        "w-full text-left p-4 border rounded-lg transition-all duration-200",
                        btnClass
                      )}
                    >
                      <span className="font-bold mr-2">{opt.id.toUpperCase()}.</span> {opt.text}
                    </button>
                  );
                })}
              </div>
           </div>
        </main>
      </div>
    );
  }

  if (view === 'ADMIN_DASHBOARD') {
    return (
      <div className="min-h-screen bg-gray-100">
        <header className="bg-white shadow">
          <div className="max-w-7xl mx-auto px-4 py-4 flex justify-between items-center">
            <h1 className="text-xl font-bold text-gray-900">Admin Dashboard</h1>
            <div className="flex items-center gap-4">
              <span className="bg-blue-100 text-blue-800 px-3 py-1 rounded-full text-sm font-medium">
                Active Users: {onlineCount}
              </span>
              <Button onClick={() => { setUser(null); setView('LOGIN_SELECT'); }} className="bg-gray-200 text-gray-800 hover:bg-gray-300">Logout</Button>
            </div>
          </div>
        </header>

        <main className="max-w-7xl mx-auto px-4 py-8 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card>
              <h2 className="text-lg font-bold mb-4">Manage Quiz</h2>
              <div className="space-y-4">
                <Button 
                  onClick={async () => {
                     // Publish "Daily Quiz"
                     // In a real app, this would select 10 random questions or a specific set.
                     // Here we just publish the dummy quiz with the seeded questions.
                     const id = `daily-quiz-${new Date().toISOString().split('T')[0]}`;
                     const allQs = await MockBackend.getQuestions();
                     // Take first 10 for the daily quiz
                     const dailyQIds = allQs.slice(0, 10).map(q => q.id);
                     
                     await MockBackend.createQuiz({
                       id,
                       title: `Daily Quiz - ${new Date().toLocaleDateString()}`,
                       durationMinutes: 10,
                       questionIds: dailyQIds,
                       status: QuizStatus.PUBLISHED, // Auto publish
                       publishedAt: Date.now()
                     });
                     
                     // Trigger update
                     await MockBackend.publishQuiz(id);
                     alert('Daily Quiz Published!');
                     loadAdminData();
                  }} 
                  className="w-full justify-center bg-green-600 hover:bg-green-700"
                >
                  Publish Daily Quiz (10 Questions)
                </Button>
                <div className="text-sm text-gray-500 mt-2">
                  Publishes 10 questions. Students have 10 minutes total.
                </div>
              </div>
            </Card>

            <Card className="md:col-span-2 lg:col-span-1">
              <h2 className="text-lg font-bold mb-4">Registered Students & Results</h2>
              <div className="h-96 overflow-y-auto border rounded bg-white">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Code</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Result</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {students.map(s => (
                      <tr key={s.id}>
                        <td className="px-4 py-2 whitespace-nowrap text-sm font-bold text-blue-600">{s.id}</td>
                        <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-900">{s.name}</td>
                        <td className="px-4 py-2 whitespace-nowrap text-sm font-bold text-gray-700">
                          {getStudentScore(s.id)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {students.length === 0 && <p className="text-center text-gray-500 p-4">No students found.</p>}
              </div>
            </Card>
          </div>
        </main>
      </div>
    );
  }

  return <div>Loading...</div>;
}