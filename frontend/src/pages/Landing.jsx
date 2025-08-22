import { useState } from "react";
import { ArrowDownIcon, ChevronDownIcon, ChevronUpIcon } from "@heroicons/react/24/solid";
import landingImage from "../assets/landing-image.jpg";

export default function Landing() {
  const [isOpen, setIsOpen] = useState(false);

  const toggleDropdown = () => setIsOpen(!isOpen);

  return (
    <div className="flex flex-col h-screen w-full">
      {/* Top buffer */}
      <div className="h-16 bg-primary"></div>

      {/* Main landing content */}
      <div className="flex flex-1">
        {/* Left side */}
        <div className="w-1/2 bg-primary relative flex flex-col justify-center items-start p-16 text-white overflow-hidden">
          <h1 className="text-6xl font-bold mb-4">Psoriasis Severity Tracker</h1>
          <p className="text-xl mb-8">
            Track your skin progress with AI-powered insights.
          </p>

          <a
            href="/login"
            className="flex items-center bg-secondary px-6 py-3 rounded-full shadow hover:bg-blue-700 transition mb-4"
          >
            Get Started
            <ArrowDownIcon className="w-5 h-5 ml-2 animate-bounce" />
          </a>

          {/* Dropdown trigger */}
          <button
            onClick={toggleDropdown}
            className="text-white hover:underline font-medium transition"
            >
            Learn more...
          </button>

          {/* Dropdown content */}
          {isOpen && (
            <div className="mt-4 p-6 bg-white bg-opacity-10 rounded-lg text-white space-y-4 shadow-md max-w-md">
              <h3 className="text-xl font-semibold">About This Project</h3>
              <p>
                This app was designed to help users track their psoriasis severity over time.
              </p>

              <h3 className="text-xl font-semibold">How It Started</h3>
              <p>
                The idea came from my personal experience wanting an easy way for my friends to monitor skin health and share results with dermatologists.
              </p>

              <h3 className="text-xl font-semibold">About Me</h3>
              <p>
                I'm a developer passionate about health-tech applications that empower users to better understand and manage their health journey.
              </p>
            </div>
          )}

          <div className="absolute top-0 right-0 h-full w-40 bg-white rounded-l-full opacity-10"></div>
        </div>

        {/* Right side */}
        <div className="w-1/2 relative">
          <img
            src={landingImage}
            alt="Landing Illustration"
            className="h-full w-full object-cover rounded-l-[50%] md:rounded-l-[30%]"
          />
        </div>
      </div>
    </div>
  );
}




