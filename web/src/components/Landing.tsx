import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Activity, ArrowRight, Zap } from 'lucide-react';
import { 
  Navbar, 
  NavbarBrand, 
  Button,
} from '@heroui/react';
import { cn } from '@/lib/utils';

export default function Landing() {
  const navigate = useNavigate();
  const [isScrolled, setIsScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 10);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground overflow-x-hidden">
      {/* Background Orbs */}
      <div className="fixed top-0 left-0 w-full h-full pointer-events-none -z-10">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-primary/20 rounded-full blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-primary/10 rounded-full blur-[120px]" />
      </div>

      <Navbar 
        isBordered={isScrolled}
        maxWidth="xl"
        className={cn(
          "transition-all duration-300",
          !isScrolled && "bg-transparent backdrop-blur-none border-none"
        )}
      >
        <NavbarBrand className="cursor-pointer gap-3" onClick={() => navigate('/')}>
          <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <Activity className="h-6 w-6 text-primary" />
          </div>
          <p className="font-bold text-xl tracking-tight text-inherit">HealthMap</p>
        </NavbarBrand>
      </Navbar>

      <main className="container mx-auto px-6 pt-32 pb-24 flex flex-col items-center justify-center min-h-[calc(100vh-64px)]">
        <div className="max-w-4xl mx-auto text-center space-y-8">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 border border-primary/20 text-xs font-semibold text-primary animate-in fade-in slide-in-from-bottom-3 duration-500">
            <Zap className="h-3 w-3" />
            <span>AI-Powered Health Data Mapping</span>
          </div>
          
          <h1 className="text-5xl md:text-7xl font-extrabold tracking-tight leading-tight animate-in fade-in slide-in-from-bottom-4 delay-75 duration-700">
            Map health data <br />
            <span className="text-primary italic">seamlessly.</span>
          </h1>
          
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto animate-in fade-in slide-in-from-bottom-5 delay-150 duration-700">
            Intelligent parsing, validation, and mapping for your clinical data. 
            Transform messy spreadsheets into structured healthcare insights.
          </p>

          <div className="flex items-center justify-center pt-4 animate-in fade-in slide-in-from-bottom-6 delay-300 duration-700">
            <Button 
              color="primary" 
              size="lg" 
              className="h-14 px-8 text-lg gap-2 rounded-full"
              onPress={() => navigate('/dashboard')}
              endContent={<ArrowRight className="h-5 w-5" />}
            >
              Test Demo
            </Button>
          </div>
        </div>
      </main>
    </div>
  );
}
