import { FolderKanban, House, Images, User } from "@/ui/icons";
import Tabs from "expo-router/js-tabs";
import { TabBar } from "@/components/TabBar";
import { useRightRail } from "@/theme";
import { Icon } from "@/ui";

/**
 * The four top-level surfaces. The bar carries no camera: capture belongs to a
 * job, so it is on Home and on each project page (see `TabBar`).
 *
 * Which four is a judgement about the field, not a mirror of the web sidebar.
 * The bar holds the set someone standing on a site opens: what needs them, the
 * jobs, the pictures, and their own account. Everything else the web sidebar
 * lists is one tap further, in the app menu (`AppMenu`), which Home's header
 * opens on a phone.
 *
 * **Home replaced Projects as the first tab**, and the project list moved to
 * `projects.tsx` beside it. Opening onto a list of jobs makes finding a job the
 * first thing the app is for, and it is not: knowing whether anything needs you
 * is. Activity moved out of the bar entirely and is reached from the menu, because
 * "what everyone else did" is a browse surface rather than a reason to open the
 * app. It kept its
 * `/activity` path, so nothing that linked to it broke.
 *
 * `headerShown` is off because the parent stack draws the header. Two
 * navigators both rendering one would stack two title bars on every tab.
 *
 * On a tablet or in landscape there is no bar: `TabBar` floats a menu button
 * on the right edge instead, and these four are rows in the
 * app menu with everything else. `tabBarPosition` is "right" there so the
 * navigator reports no bottom bar height to the screens, and the floating
 * button takes no width from them. Read here, from the same hook the bar uses,
 * so the two can never disagree after a rotation.
 */
export default function TabsLayout() {
  const rail = useRightRail();
  return (
    <Tabs
      /*
       * The tabs remember the order they were opened in, so Back (the key on
       * Android, and the arrow `useTabBack` puts in a tab's header) returns
       * to the tab someone came from, not always to Home.
       */
      backBehavior="history"
      screenOptions={{ headerShown: false, tabBarPosition: rail ? "right" : "bottom" }}
      tabBar={(props) => <TabBar {...props} />}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          tabBarIcon: ({ color }) => <Icon icon={House} size="lg" color={color} />,
        }}
      />
      <Tabs.Screen
        name="projects"
        options={{
          title: "Projects",
          tabBarIcon: ({ color }) => <Icon icon={FolderKanban} size="lg" color={color} />,
        }}
      />
      <Tabs.Screen
        name="gallery"
        options={{
          title: "Gallery",
          tabBarIcon: ({ color }) => <Icon icon={Images} size="lg" color={color} />,
        }}
      />
      <Tabs.Screen
        name="account"
        options={{
          title: "Account",
          tabBarIcon: ({ color }) => <Icon icon={User} size="lg" color={color} />,
        }}
      />
    </Tabs>
  );
}
