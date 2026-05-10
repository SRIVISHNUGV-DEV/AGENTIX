import { HeroSection } from "@/components/landing/hero-section";
import { DeveloperSection } from "@/components/landing/developer-section";
import { PlatformSection } from "@/components/landing/platform-section";
import { SecuritySection } from "@/components/landing/security-section";
import { CTASection } from "@/components/landing/cta-section";
import { FooterSection } from "@/components/landing/footer-section";

export default function Home() {
  return (
    <main className="min-h-screen bg-black">
      <HeroSection />
      <DeveloperSection />
      <PlatformSection />
      <SecuritySection />
      <CTASection />
      <FooterSection />
    </main>
  );
}
