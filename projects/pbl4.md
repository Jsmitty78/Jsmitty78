[Back to profile](../README.md) · [Team repository](https://github.com/daitera1/PBL4-G1)

# PBL4 · Multi-projector image blending

**Bringing two projector outputs into one wide image—and bringing a 12-person team through the build.**

Ritsumeikan University · PBL4 Group 1 · Final handover: 12 November 2026

![Two-projector output photographed by the team](https://raw.githubusercontent.com/daitera1/PBL4-G1/main/Documentation/final-deliverable-2026-11-12/real.JPG)

*Project photograph from the team's final documentation.*

## The project

Our team built a Python application that prepares an image for two adjacent projectors. Each projector displays its side of the image, with an overlapping region between them. The program applies alpha masks with gamma compensation to control the brightness across that overlap.

The repository contains **two implementations**: a baseline without gamma correction and a version with gamma correction for comparison. It also includes sample inputs, configuration, UML diagrams, technical documentation, presentation slides, and the team's project records.

**Stack:** Python, OpenCV, NumPy, JSON configuration, UML/Astah, Doxygen, Jira.

## My contribution

I served as **project manager**, coordinating 12 members across Development, Documentation, and Management.

- **Team coordination:** assigned responsibilities, ran department-lead check-ins, and followed up on progress and dependencies.
- **Shared workflow:** organized Jira tasks, schedules, communication, and shared project files so the departments could work together.
- **Practical setup:** helped the development team with the projector setup during class.
- **Handover:** coordinated department reviews and the evidence index, connecting code, documentation, presentation, and management records for review.

This was a team engineering project. The image-processing implementations are presented as the team's work; my focus was project leadership, coordination, practical support, and delivery.

[Weekly team record](https://github.com/daitera1/PBL4-G1/blob/main/Management/WEEKLY_REVIEW.md) · [My coordination plan](https://github.com/daitera1/PBL4-G1/blob/main/Management/planning/Jake-Week-3-Coordination-Plan.md) · [Department review assignment](https://github.com/daitera1/PBL4-G1/blob/main/Management/jira/issues/PG1-41.md)

## How the software is organized

| Stage | Responsibility |
| :--- | :--- |
| Configure | Read the image, projector side, overlap, and gamma settings. |
| Crop | Prepare the left or right portion of the source image. |
| Create the mask | Generate a fade across the overlap for the selected projector side. |
| Blend | Apply the mask through the baseline or gamma-compensated implementation. |
| Display | Show the prepared output in an OpenCV fullscreen window. |

The runnable programs live in `Development/` and start with `main.py`. The class skeletons in the documentation package explain the design; the [current setup guide](https://github.com/daitera1/PBL4-G1/blob/main/Documentation/setup.md) identifies the delivered application and its commands.

## Explore the work

| Artifact | Where to look |
| :--- | :--- |
| Source code and run instructions | [Development](https://github.com/daitera1/PBL4-G1/tree/main/Development) |
| Final documentation and project photographs | [Documentation overview](https://github.com/daitera1/PBL4-G1/blob/main/Documentation/FINAL_DOCUMENTATION.md) |
| UML and system design | [Design files](https://github.com/daitera1/PBL4-G1/tree/main/Documentation/design) |
| 27-slide presentation, PDF and PowerPoint | [Presentation](https://github.com/daitera1/PBL4-G1/tree/main/Presentation) |
| Task ownership, schedule, and weekly progress | [Management review](https://github.com/daitera1/PBL4-G1/blob/main/Management/WEEKLY_REVIEW.md) |
| Guided review of the complete submission | [Start here](https://github.com/daitera1/PBL4-G1/blob/main/PROFESSOR_START_HERE.md) |

## Results and scope

The final handover brings together the two Python implementations, technical documentation, demonstration photographs, a presentation, and the team's management records. The final Jira snapshot records 52 tickets as Done on 12 November 2026.

The photographs and presentation document the team's demonstration. Packaging checks cover file integrity, links, and Python syntax; they do not independently measure projector calibration or image quality. See the team's [verification notes](https://github.com/daitera1/PBL4-G1/blob/main/Documentation/verification.md) for the precise checks and remaining limitations.

![The PBL4 team working with the projectors](https://raw.githubusercontent.com/daitera1/PBL4-G1/main/Documentation/final-deliverable-2026-11-12/team.jpg)

*Team photo from the final project documentation.*
