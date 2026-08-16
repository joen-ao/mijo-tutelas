import { Footer } from "@/components/layout/footer";
import { Header } from "@/components/layout/header";
import { Authorization } from "@/components/sections/authorization";
import { Corpus } from "@/components/sections/corpus";
import { EvalResults } from "@/components/sections/eval-results";
import { FinalCta } from "@/components/sections/final-cta";
import { Hero } from "@/components/sections/hero";
import { Milestones } from "@/components/sections/milestones";
import { PhoneChannel } from "@/components/sections/phone-channel";
import { Problem } from "@/components/sections/problem";
import { Process } from "@/components/sections/process";
import { StatsBand } from "@/components/sections/stats-band";
import { TechStack } from "@/components/sections/tech-stack";
import { Verifier } from "@/components/sections/verifier";

export default function Home() {
  return (
    <>
      <Header />
      <main>
        <Hero />
        <StatsBand />
        <Problem />
        <Process />
        <PhoneChannel />
        <Verifier />
        <EvalResults />
        <Milestones />
        <Authorization />
        <Corpus />
        <TechStack />
        <FinalCta />
      </main>
      <Footer />
    </>
  );
}
